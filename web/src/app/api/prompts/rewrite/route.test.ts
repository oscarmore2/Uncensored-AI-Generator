import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createSseParser } from "@/lib/llm/sse";

/**
 * 路由层的编排：并发锁、审查的先后、扣费口径、微点结算、用量台账。
 *
 * 这里**不测**改写质量，那是提示词的事。测的是「顺序对不对、钱算得对不对」——
 * 出口审查要在扣费之前跑完（状态得记成 blocked），但**拦下来照样扣**，
 * 因为上游已经跑过了。搞错任何一条，症状都是「钱扣了但没东西」
 * 或者「白嫖了一次大模型」。
 */

const user = { id: 7, balance: 100, isVip: false, vipExpiresAt: null, vipTier: null };

let blockedFragments: string[] = [];
/** 假库：只存这一条链路真正会碰的东西 */
const state = {
  aiDebtMicro: 0,
  balance: 100,
  logs: [] as Record<string, unknown>[],
  transactions: [] as Record<string, unknown>[],
};

vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => ({ ...user, balance: state.balance }) }));
vi.mock("@/lib/adult-access", () => ({ hasAdultAccess: () => false }));
vi.mock("@/lib/content-safety", () => ({
  reviewPrompt: async ({ prompt }: { prompt: string }) => ({
    level: blockedFragments.some((f) => prompt.includes(f)) ? "prohibited" : "safe",
    reason: "测试拦截",
  }),
  isBlocked: (r: { level: string }) => r.level === "prohibited",
}));
vi.mock("@/lib/db", () => ({
  db: {
    llmAccount: { findFirst: async () => null },
    // 技能表为空 → 退回 definitions.ts 的出厂定义，与线上首次部署时一致
    skill: { findMany: async () => [], findUnique: async () => null, create: async () => ({}) },
    // 库里没有覆盖行 → 退回 models.ts 的出厂常量
    llmModel: { upsert: async () => ({}), findFirst: async () => null },
    llmUsageLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.logs.push(data);
        return data;
      },
    },
    transaction: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.transactions.push(data);
        return data;
      },
    },
    user: {
      findUnique: async () => ({ aiDebtMicro: state.aiDebtMicro }),
      updateMany: async ({
        where,
        data,
      }: {
        where: { aiDebtMicro?: number };
        data: { aiDebtMicro: number; balance?: { decrement: number } };
      }) => {
        // 乐观并发的比较那一半也得照做，不然测不出 CAS 有没有生效
        if (where.aiDebtMicro !== undefined && where.aiDebtMicro !== state.aiDebtMicro) {
          return { count: 0 };
        }
        state.aiDebtMicro = data.aiDebtMicro;
        if (data.balance) state.balance -= data.balance.decrement;
        return { count: 1 };
      },
    },
  },
}));

let upstream: Server;
let respond: (res: import("node:http").ServerResponse) => void;

beforeAll(async () => {
  upstream = createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => respond(res));
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));

  process.env.DATABASE_URL = "postgresql://unused:unused@127.0.0.1:1/unused";
  process.env.AUTH_SECRET = "test-only-secret-test-only-secret-abc";
  process.env.OPENROUTER_API_KEY = "sk-test";
  process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1`;
});

afterAll(() => new Promise<void>((resolve) => upstream.close(() => resolve())));

beforeEach(() => {
  blockedFragments = [];
  state.aiDebtMicro = 0;
  state.balance = 100;
  state.logs = [];
  state.transactions = [];
});

function sse(res: import("node:http").ServerResponse, chunks: unknown[], gapMs = 1) {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  let i = 0;
  const next = () => {
    if (i >= chunks.length) {
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    res.write(`data: ${JSON.stringify(chunks[i++])}\n\n`);
    setTimeout(next, gapMs);
  };
  next();
}

const delta = (content: string) => ({ choices: [{ delta: { content } }] });
const usageChunk = (prompt: number, completion: number, cost?: number) => ({
  choices: [],
  usage: { prompt_tokens: prompt, completion_tokens: completion, ...(cost != null ? { cost } : {}) },
});

function post(body: Record<string, unknown>, init?: RequestInit) {
  return new Request("http://localhost/api/prompts/rewrite", {
    method: "POST",
    ...init,
    body: JSON.stringify({
      action: "polish",
      selection: "她站在窗边",
      context_before: "开场。",
      context_after: "收尾。",
      mode: "txt2img",
      ...body,
    }),
  });
}

/** 把 SSE 响应读成事件数组 */
async function readEvents(resp: Response): Promise<Record<string, unknown>[]> {
  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();
  const out: Record<string, unknown>[] = [];
  const drain = (payloads: string[]) => {
    for (const p of payloads) out.push(JSON.parse(p) as Record<string, unknown>);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    drain(parser.feed(decoder.decode(value, { stream: true })));
  }
  drain(parser.flush());
  return out;
}

describe("选区改写路由", () => {
  it("流式：先出 delta，最后 done 带这次的花费与零头", async () => {
    const { POST } = await import("./route");
    respond = (res) => sse(res, [delta("柔光下"), delta("的她"), usageChunk(800, 200)]);

    const resp = await POST(post({ stream: true }));
    expect(resp.headers.get("content-type")).toContain("text/event-stream");

    const events = await readEvents(resp);
    expect(events.filter((e) => e.type === "delta").map((e) => e.text)).toEqual(["柔光下", "的她"]);
    /*
     * 800 in + 200 out，基础档 $0.15/$0.60 每百万 = $0.00024；
     * 除以单点 $0.009995 × 1000 微点 × 130% ≈ 31 微点 = 0.031 点。
     * 按整点收的话这一次就是 1 点——32 倍，这正是微点存在的理由。
     */
    expect(events.at(-1)).toMatchObject({
      type: "done",
      text: "柔光下的她",
      charged_micro: 31,
      charged_credits: "0.031",
      settled_credits: 0,
      debt_micro: 31,
    });
    // 攒不满 1 点，余额一动不动
    expect(state.balance).toBe(100);
  });

  it("上游给了真账就用真账，不用本地单价估", async () => {
    const { POST } = await import("./route");
    respond = (res) => sse(res, [delta("ok"), usageChunk(800, 200, 0.0003)]);

    await readEvents(await POST(post({ stream: true })));
    expect(state.logs[0]).toMatchObject({
      costUsdMicro: 300,
      costEstimated: false,
      status: "ok",
      trigger: "selection",
      skillKey: "polish",
      modelKey: "basic-4o-mini",
    });
  });

  it("上游不给成本时按本地单价估，并在台账上标出来", async () => {
    const { POST } = await import("./route");
    respond = (res) => sse(res, [delta("ok"), usageChunk(800, 200)]);

    await readEvents(await POST(post({ stream: true })));
    expect(state.logs[0]).toMatchObject({ costUsdMicro: 240, costEstimated: true });
  });

  it("零头攒满 1 点才动余额，并留一条流水", async () => {
    const { POST } = await import("./route");
    respond = (res) => sse(res, [delta("ok"), usageChunk(800, 200)]);

    state.aiDebtMicro = 980;
    const events = await readEvents(await POST(post({ stream: true })));
    expect(events.at(-1)).toMatchObject({ settled_credits: 1, debt_micro: 11 });
    expect(state.balance).toBe(99);
    expect(state.transactions).toEqual([{ userId: 7, type: "ai_skill", amount: -1 }]);
  });

  it("入口审查按「替换之后的整段」判，被拦时上游一次都不调、一分钱不收", async () => {
    const { POST } = await import("./route");
    let called = false;
    respond = (res) => {
      called = true;
      sse(res, [delta("x")]);
    };
    // 拦的是上下文里的词——片段本身完全无害，正说明审的是整段
    blockedFragments = ["开场。"];

    const resp = await POST(post({ stream: true }));
    expect(resp.status).toBe(422);
    await expect(resp.json()).resolves.toMatchObject({ code: "CONTENT_POLICY_REJECTED" });
    expect(called).toBe(false);
    expect(state.logs).toEqual([]);
  });

  it("出口审查拦下来：走 error 事件，但**照样扣费**", async () => {
    const { POST } = await import("./route");
    respond = (res) => sse(res, [delta("越线的"), delta("句子"), usageChunk(800, 200)]);
    blockedFragments = ["越线的句子"];

    const events = await readEvents(await POST(post({ stream: true })));
    // 文字已经流出去了——这正是为什么替换按钮必须等 done
    expect(events.filter((e) => e.type === "delta")).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({
      type: "error",
      code: "CONTENT_POLICY_REJECTED",
      charged_micro: 31,
    });
    // 上游已经跑过了，成本已经发生。这条必须写进用户可见文案
    expect(state.logs[0]).toMatchObject({ status: "blocked", chargedMicro: 31 });
  });

  it("不存在的技能直接拒掉，不去调上游", async () => {
    const { POST } = await import("./route");
    let called = false;
    respond = (res) => {
      called = true;
      sse(res, [delta("x")]);
    };

    const resp = await POST(post({ action: "no-such-skill", stream: true }));
    expect(resp.status).toBe(400);
    await expect(resp.json()).resolves.toMatchObject({ code: "SKILL_UNAVAILABLE" });
    expect(called).toBe(false);
  });

  it("余额为 0 时拦在入口，不许发起新调用", async () => {
    const { POST } = await import("./route");
    respond = (res) => sse(res, [delta("x")]);
    state.balance = 0;

    const resp = await POST(post({ stream: true }));
    expect(resp.status).toBe(400);
    await expect(resp.json()).resolves.toMatchObject({ code: "INSUFFICIENT_CREDITS" });
  });

  it("余额被扣成负数也照样结算完——上游的钱已经花了", async () => {
    const { POST } = await import("./route");
    respond = (res) => sse(res, [delta("ok"), usageChunk(800, 200)]);
    state.balance = 1;
    state.aiDebtMicro = 999;

    await readEvents(await POST(post({ stream: true })));
    expect(state.balance).toBe(0);

    // 下一次就会被入口挡住，所以透支面天然有界
    state.balance = 0;
    expect((await POST(post({ stream: true }))).status).toBe(400);
  });

  it("非流式仍然回 JSON", async () => {
    const { POST } = await import("./route");
    respond = (res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: "柔光下的她" } }],
          usage: { prompt_tokens: 800, completion_tokens: 200 },
        })
      );
    };

    const resp = await POST(post({}));
    expect(resp.headers.get("content-type")).toContain("application/json");
    await expect(resp.json()).resolves.toMatchObject({
      ok: true,
      text: "柔光下的她",
      charged_micro: 31,
    });
  });

  it("同一个用户第二个请求被并发锁挡住", async () => {
    const { POST } = await import("./route");
    respond = (res) => sse(res, [delta("慢"), delta("慢"), delta("写")], 40);

    const first = POST(post({ stream: true }));
    await new Promise((r) => setTimeout(r, 10));
    const second = await POST(post({ stream: true }));
    expect(second.status).toBe(429);
    await expect(second.json()).resolves.toMatchObject({ code: "AI_BUSY" });

    // 第一个跑完之后锁要还回去，否则这个用户就永远用不了了
    await readEvents(await first);
    const third = await POST(post({ stream: true }));
    expect(third.status).not.toBe(429);
    await readEvents(third);
  });

  it("用户中途取消：已经吐出来的 token 照扣，状态记成 canceled", async () => {
    const { POST } = await import("./route");
    respond = (res) => sse(res, [delta("一"), delta("二"), delta("三"), delta("四")], 30);

    const controller = new AbortController();
    const resp = await POST(post({ stream: true }, { signal: controller.signal }));
    const reader = resp.body!.getReader();
    await reader.read();
    controller.abort();
    await new Promise((r) => setTimeout(r, 120));

    /*
     * 不收的话，「点了就取消」就是一个免费无限调用大模型的口子。
     * 拿不到 usage 也得按已经收到的文字估——查不到成本不能变成不扣费。
     */
    expect(state.logs[0]).toMatchObject({ status: "canceled", costEstimated: true });
    expect(Number(state.logs[0].chargedMicro)).toBeGreaterThan(0);
    expect(Number(state.logs[0].completionTokens)).toBeGreaterThan(0);
  });

  it("上游挂掉时回 error 事件，不收钱，但落一条 failed", async () => {
    const { POST } = await import("./route");
    respond = (res) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end("{}");
    };

    const events = await readEvents(await POST(post({ stream: true })));
    expect(events.at(-1)).toMatchObject({ type: "error" });
    expect(state.logs[0]).toMatchObject({ status: "failed", chargedMicro: 0 });
    expect(state.balance).toBe(100);
  });
});
