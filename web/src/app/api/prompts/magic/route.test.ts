import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * 整段级技能（`manual`）。魔法指令归位之后走的就是这条路。
 *
 * 重点验三件事：它和选区级共用同一套计费与台账；本地兜底那条路**不收钱**；
 * 出口审查拦下来**照收**。第二和第三条看着矛盾，其实是同一条判据：
 * 上游跑了没有。
 */

const user = { id: 7, balance: 100, isVip: false, vipExpiresAt: null, vipTier: null };
let blockedFragments: string[] = [];
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
    llmModel: { upsert: async () => ({}), findFirst: async () => null },
    skill: { findMany: async () => [], findUnique: async () => null, create: async () => ({}) },
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
/** 上一次真正送到上游的请求体，用来验「模型看到了什么」 */
let lastUpstreamBody = "";

beforeAll(async () => {
  upstream = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      lastUpstreamBody = body;
      respond(res);
    });
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
  lastUpstreamBody = "";
  state.aiDebtMicro = 0;
  state.balance = 100;
  state.logs = [];
  state.transactions = [];
});

/** 假上游回一段普通 chat-completions（非流式，整段级不需要流） */
function reply(content: string, usage = { prompt_tokens: 800, completion_tokens: 200 }) {
  return (res: import("node:http").ServerResponse) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content } }], usage }));
  };
}

function post(body: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/prompts/magic", {
    method: "POST",
    body: JSON.stringify({ prompt: "一只橘猫坐在窗台", mode: "txt2img", ...body }),
  });
}

describe("整段级技能路由", () => {
  it("跑通一次，扣的是微点，台账记在 manual 时机下", async () => {
    const { POST } = await import("./route");
    // txt2img 支持反向提示词，所以平台要求模型回 JSON
    respond = reply(
      JSON.stringify({ positive_prompt: "一只橘猫端坐窗台，暖调侧光", negative_prompt: "模糊, 变形" })
    );

    const resp = await POST(post());
    expect(resp.status).toBe(200);
    await expect(resp.json()).resolves.toMatchObject({
      ok: true,
      prompt: "一只橘猫端坐窗台，暖调侧光",
      negative_prompt: "模糊, 变形",
      source: "llm",
      charged_micro: 31,
    });
    expect(state.logs[0]).toMatchObject({
      skillKey: "magic-prompt",
      trigger: "manual",
      modelKey: "basic-4o-mini",
      status: "ok",
    });
  });

  it("不支持反向的模式回纯文本，不强求 JSON", async () => {
    const { POST } = await import("./route");
    respond = reply("一只橘猫端坐窗台，暖调侧光");

    const resp = await POST(post({ mode: "imgedit" }));
    await expect(resp.json()).resolves.toMatchObject({
      prompt: "一只橘猫端坐窗台，暖调侧光",
      negative_prompt: null,
    });
  });

  it("上游挂掉时退回本地扩写，而且**不收钱**——一个 token 都没烧", async () => {
    const { POST } = await import("./route");
    respond = (res) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end("{}");
    };

    const resp = await POST(post());
    const data = (await resp.json()) as { source: string; prompt: string; charged_micro?: number };
    expect(data.source).toBe("local");
    expect(data.prompt).toContain("一只橘猫坐在窗台");
    expect(data.charged_micro).toBeUndefined();
    expect(state.logs).toEqual([]);
    expect(state.balance).toBe(100);
  });

  it("出口审查拦下来：422，但**照样扣费**", async () => {
    const { POST } = await import("./route");
    respond = reply(JSON.stringify({ positive_prompt: "越线的整段", negative_prompt: "" }));
    blockedFragments = ["越线的整段"];

    const resp = await POST(post());
    expect(resp.status).toBe(422);
    await expect(resp.json()).resolves.toMatchObject({
      code: "CONTENT_POLICY_REJECTED",
      charged_micro: 31,
    });
    expect(state.logs[0]).toMatchObject({ status: "blocked", chargedMicro: 31 });
  });

  it("入口审查拦下来：不调上游，一分钱不收", async () => {
    const { POST } = await import("./route");
    let called = false;
    respond = (res) => {
      called = true;
      reply("x")(res);
    };
    blockedFragments = ["一只橘猫坐在窗台"];

    expect((await POST(post())).status).toBe(422);
    expect(called).toBe(false);
    expect(state.logs).toEqual([]);
  });

  it("素材引用送出去是占位符，回来还原成 @Image1", async () => {
    const { POST } = await import("./route");
    respond = (res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            { message: { content: JSON.stringify({ positive_prompt: "参考 [[REF1]] 的光线" }) } },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 20 },
        })
      );
    };

    const resp = await POST(post({ prompt: "参考 @Image1 的光线" }));
    await expect(resp.json()).resolves.toMatchObject({ prompt: "参考 @Image1 的光线" });
    /*
     * 模型永远不该看到 @Image1：它会顺手译成 reference image 1、并进句子、
     * 重新编号或者删掉——全都不报错，用户只看到出片不对。
     */
    expect(lastUpstreamBody).not.toContain("@Image1");
    expect(lastUpstreamBody).toContain("[[REF1]]");
  });

  it("不存在的技能直接拒掉", async () => {
    const { POST } = await import("./route");
    let called = false;
    respond = (res) => {
      called = true;
      reply("x")(res);
    };

    const resp = await POST(post({ skill: "no-such-skill" }));
    expect(resp.status).toBe(400);
    await expect(resp.json()).resolves.toMatchObject({ code: "SKILL_UNAVAILABLE" });
    expect(called).toBe(false);
  });

  it("选区级技能不能从整段入口跑", async () => {
    const { POST } = await import("./route");
    // polish 只绑了 selection，从这里调应该被时机校验挡住
    const resp = await POST(post({ skill: "polish" }));
    expect(resp.status).toBe(400);
    await expect(resp.json()).resolves.toMatchObject({ code: "SKILL_UNAVAILABLE" });
  });

  it("余额为 0 时拦在入口", async () => {
    const { POST } = await import("./route");
    respond = reply("x");
    state.balance = 0;
    const resp = await POST(post());
    expect(resp.status).toBe(400);
    await expect(resp.json()).resolves.toMatchObject({ code: "INSUFFICIENT_CREDITS" });
  });
});
