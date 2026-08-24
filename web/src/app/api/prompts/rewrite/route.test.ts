import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createSseParser } from "@/lib/llm/sse";

/**
 * 路由层的编排：并发锁、审查的先后、扣点、SSE 的帧。
 *
 * 这里**不测**改写质量，那是提示词的事。测的是「顺序对不对」——
 * 出口审查必须在扣点之前，被拦下来就不能收钱；流已经开始之后失败，
 * 错误只能走事件而不是状态码。搞错任何一条，症状都是「钱扣了但没东西」。
 */

const user = { id: 7, balance: 100 };
let blockedFragments: string[] = [];
let charged: { charged: number } | null = null;

vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => user }));
vi.mock("@/lib/adult-access", () => ({ hasAdultAccess: () => false }));
vi.mock("@/lib/ai-token-billing", () => ({ getAiCreditsPer1kTokens: async () => 1000 }));
vi.mock("@/lib/content-safety", () => ({
  reviewPrompt: async ({ prompt }: { prompt: string }) => ({
    level: blockedFragments.some((f) => prompt.includes(f)) ? "prohibited" : "safe",
    reason: "测试拦截",
  }),
  isBlocked: (r: { level: string }) => r.level === "prohibited",
}));
vi.mock("@/lib/db", () => ({
  db: {
    user: {
      updateMany: async ({ data }: { data: { balance: { decrement: number } } }) => {
        charged = { charged: data.balance.decrement };
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
  charged = null;
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
const usageChunk = (prompt: number, completion: number) => ({
  choices: [],
  usage: { prompt_tokens: prompt, completion_tokens: completion },
});

function post(body: Record<string, unknown>) {
  return new Request("http://localhost/api/prompts/rewrite", {
    method: "POST",
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
  it("流式：先出 delta，最后 done 带扣点", async () => {
    const { POST } = await import("./route");
    respond = (res) => sse(res, [delta("柔光下"), delta("的她"), usageChunk(800, 200)]);

    const resp = await POST(post({ stream: true }));
    expect(resp.headers.get("content-type")).toContain("text/event-stream");

    const events = await readEvents(resp);
    expect(events.filter((e) => e.type === "delta").map((e) => e.text)).toEqual(["柔光下", "的她"]);
    // 费率 1000 点 / 1k token，1000 token 就是 1000 点
    expect(events.at(-1)).toMatchObject({ type: "done", text: "柔光下的她", charged: 1000 });
    expect(charged).toEqual({ charged: 1000 });
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
    await expect(resp.json()).resolves.toMatchObject({ ok: true, text: "柔光下的她", charged: 1000 });
  });

  it("入口审查按「替换之后的整段」判，被拦时上游一次都不调", async () => {
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
    expect(charged).toBeNull();
  });

  it("出口审查在流的末尾拦下来时走 error 事件，且不扣钱", async () => {
    const { POST } = await import("./route");
    respond = (res) => sse(res, [delta("越线的"), delta("句子"), usageChunk(800, 200)]);
    blockedFragments = ["越线的句子"];

    const events = await readEvents(await POST(post({ stream: true })));
    // 文字已经流出去了——这正是为什么替换按钮必须等 done
    expect(events.filter((e) => e.type === "delta")).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({ type: "error", code: "CONTENT_POLICY_REJECTED" });
    expect(charged).toBeNull();
  });

  it("同一个用户第二个请求被并发锁挡住", async () => {
    const { POST } = await import("./route");
    respond = (res) => sse(res, [delta("慢"), delta("慢"), delta("写")], 40);

    const first = POST(post({ stream: true }));
    // 等第一个真正开始跑（锁是在 handler 里同步拿的，await 一轮就够）
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

  it("上游挂掉时回 error 事件而不是空流", async () => {
    const { POST } = await import("./route");
    respond = (res) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end("{}");
    };

    const events = await readEvents(await POST(post({ stream: true })));
    expect(events.at(-1)).toMatchObject({ type: "error" });
    expect(charged).toBeNull();
  });
});
