import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { LLM_MODELS } from "./models";
import { OFFICIAL_SKILL_BY_KEY } from "../skills/definitions";
import { skillFromDefinition } from "../skills/store";

/**
 * 拿一个假上游把流式整条链路跑通。
 *
 * 为什么值得写：这条链路上每一处都是「不出错，只出怪」的类型——
 * chunk 从占位符中间断开、usage 落在最后一个空 choices 的 chunk 上、
 * 上游中途发 error 事件。这些靠手点触发不了，但线上一定会遇到。
 *
 * 假上游说的是 OpenAI 兼容那套，所以它同时代表 OpenRouter 和 HF Router。
 */

/*
 * 桩掉数据库：这些用例验的是**没有覆盖行时退回出厂常量**那条路径。
 * 连真库只会让用例变慢变飘，而且验的东西并不是这一层的。
 */
vi.mock("../db", () => ({
  db: {
    llmAccount: { findFirst: async () => null },
    llmModel: { upsert: async () => ({}), findFirst: async () => null },
  },
}));

let server: Server;
let baseUrl: string;
/** 每个用例自己决定假上游怎么回 */
let respond: (req: { body: string; res: import("node:http").ServerResponse }) => void;
let lastBody: Record<string, unknown> = {};

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      lastBody = JSON.parse(body || "{}") as Record<string, unknown>;
      respond({ body, res });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;

  process.env.DATABASE_URL = "postgresql://unused:unused@127.0.0.1:1/unused";
  process.env.AUTH_SECRET = "test-only-secret-test-only-secret-abc";
  process.env.OPENROUTER_API_KEY = "sk-test";
  process.env.OPENROUTER_BASE_URL = baseUrl;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

/**
 * 按 SSE 格式吐出一串 chunk。
 *
 * `gapMs` 不是随手写的：间隔太小的话，几条事件会挤进同一次 TCP 读，
 * 于是「取消」那条用例会时灵时不灵——不是代码有问题，是同一个 chunk
 * 里已经解析出来的 delta 不可能再收回去。要验取消就得让它们分开到达。
 */
function sse(res: import("node:http").ServerResponse, chunks: unknown[], gapMs = 1) {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  let i = 0;
  const next = () => {
    if (i >= chunks.length) {
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    const chunk = chunks[i++];
    res.write(typeof chunk === "string" ? chunk : `data: ${JSON.stringify(chunk)}\n\n`);
    setTimeout(next, gapMs);
  };
  next();
}

const delta = (content: string) => ({ choices: [{ delta: { content } }] });

describe("流式调用上游", () => {
  it("按 chunk 吐 delta，最后带上用量与真实成本", async () => {
    const { streamChat } = await import("./chat");
    respond = ({ res }) =>
      sse(res, [
        delta("光线"),
        delta("柔和"),
        { choices: [{ delta: {}, finish_reason: "stop" }] },
        { choices: [], usage: { prompt_tokens: 800, completion_tokens: 12, cost: 0.0003 } },
      ]);

    const events = [];
    for await (const ev of streamChat({ system: "s", user: "u", model: LLM_MODELS.basic })) events.push(ev);

    expect(events.filter((e) => e.type === "delta").map((e) => e.text)).toEqual(["光线", "柔和"]);
    const done = events.at(-1);
    expect(done).toMatchObject({
      type: "done",
      text: "光线柔和",
      finishReason: "stop",
      usage: { promptTokens: 800, completionTokens: 12, totalTokens: 812, costUsd: 0.0003 },
    });
    // 上游给了真账就不该再标成估算
    expect(done && done.type === "done" && done.usage.costEstimated).toBeUndefined();
  });

  it("请求体里带上 stream_options，否则流式响应根本不会回 usage", async () => {
    const { streamChat } = await import("./chat");
    respond = ({ res }) => sse(res, [delta("ok")]);
    for await (const _ of streamChat({ system: "s", user: "u", model: LLM_MODELS.basic })) void _;

    expect(lastBody.stream).toBe(true);
    expect(lastBody.stream_options).toEqual({ include_usage: true });
    expect(lastBody.usage).toEqual({ include: true });
    expect(lastBody.model).toBe("openai/gpt-4o-mini");
  });

  it("上游没给成本就按本地单价估，并标记出来", async () => {
    const { streamChat } = await import("./chat");
    respond = ({ res }) =>
      sse(res, [delta("ok"), { choices: [], usage: { prompt_tokens: 1000, completion_tokens: 1000 } }]);

    let usage;
    for await (const ev of streamChat({ system: "s", user: "u", model: LLM_MODELS.basic })) {
      if (ev.type === "done") usage = ev.usage;
    }
    // 基础档 $0.15 / $0.60 每百万：1000 + 1000 token = $0.00075
    expect(usage?.costUsd).toBeCloseTo(0.00075, 8);
    expect(usage?.costEstimated).toBe(true);
  });

  it("事件被 chunk 边界劈开也能收全", async () => {
    const { streamChat } = await import("./chat");
    respond = ({ res }) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const raw = `data: ${JSON.stringify(delta("一句完整的话"))}\n\n`;
      res.write(raw.slice(0, 20));
      setTimeout(() => {
        res.write(raw.slice(20));
        res.end();
      }, 5);
    };

    const out = [];
    for await (const ev of streamChat({ system: "s", user: "u", model: LLM_MODELS.basic })) {
      if (ev.type === "delta") out.push(ev.text);
    }
    expect(out).toEqual(["一句完整的话"]);
  });

  it("上游中途发 error 事件就抛出来，不当成正常结束", async () => {
    const { streamChat } = await import("./chat");
    respond = ({ res }) => sse(res, [delta("半"), { error: { message: "rate limited" } }]);

    await expect(async () => {
      for await (const _ of streamChat({ system: "s", user: "u", model: LLM_MODELS.basic })) void _;
    }).rejects.toThrow(/rate limited/);
  });

  it("非 2xx 带上状态码抛出", async () => {
    const { streamChat } = await import("./chat");
    respond = ({ res }) => {
      res.writeHead(402, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "insufficient credits" }));
    };

    await expect(async () => {
      for await (const _ of streamChat({ system: "s", user: "u", model: LLM_MODELS.basic })) void _;
    }).rejects.toThrow(/402/);
  });

  it("取消之后不再吐新内容", async () => {
    const { streamChat } = await import("./chat");
    respond = ({ res }) => sse(res, [delta("一"), delta("二"), delta("三"), delta("四")], 25);

    const controller = new AbortController();
    const got: string[] = [];
    await expect(async () => {
      for await (const ev of streamChat({
        system: "s",
        user: "u",
        model: LLM_MODELS.basic,
        signal: controller.signal,
      })) {
        if (ev.type === "delta") {
          got.push(ev.text);
          if (got.length === 2) controller.abort();
        }
      }
    }).rejects.toThrow();
    expect(got).toEqual(["一", "二"]);
  });
});

describe("流式改写选区", () => {
  it("素材引用被拆在两个 chunk 里也不会闪出半截占位符", async () => {
    const { streamRewriteSelection } = await import("../prompt-rewrite");
    // 模型把 [[REF1]] 分三次吐出来——真实流式下这是常态
    respond = ({ res }) => sse(res, [delta("柔光下的她，参考 [[R"), delta("EF1]"), delta("] 的构图")]);

    const deltas: string[] = [];
    let final = "";
    for await (const ev of streamRewriteSelection({
      skill: skillFromDefinition(OFFICIAL_SKILL_BY_KEY.get("polish")!),
      selection: "她站在窗边 @Image1",
      contextBefore: "",
      contextAfter: "",
      mode: "txt2img",
    })) {
      if (ev.type === "delta") deltas.push(ev.text);
      else final = ev.result.text;
    }

    // 显示出去的每一段都不能含占位符残片
    expect(deltas.join("")).not.toMatch(/\[/);
    expect(deltas.join("")).toContain("@Image1");
    expect(final).toBe("柔光下的她，参考 @Image1 的构图");
  });

  it("模型弄丢引用时如实报上来，不擅自补回去", async () => {
    const { streamRewriteSelection } = await import("../prompt-rewrite");
    respond = ({ res }) => sse(res, [delta("她站在窗边，光线柔和")]);

    let result;
    for await (const ev of streamRewriteSelection({
      skill: skillFromDefinition(OFFICIAL_SKILL_BY_KEY.get("polish")!),
      selection: "她站在窗边 @Image1",
      contextBefore: "",
      contextAfter: "",
      mode: "txt2img",
    })) {
      if (ev.type === "done") result = ev.result;
    }
    expect(result?.droppedRefs).toEqual(["Image1"]);
    expect(result?.text).toBe("她站在窗边，光线柔和");
  });

  it("模型拿代码块把结果包起来时，最终结果已去壳", async () => {
    const { streamRewriteSelection } = await import("../prompt-rewrite");
    respond = ({ res }) => sse(res, [delta("```\n她站在窗边"), delta("，光线柔和\n```")]);

    let result;
    for await (const ev of streamRewriteSelection({
      skill: skillFromDefinition(OFFICIAL_SKILL_BY_KEY.get("polish")!),
      selection: "她站在窗边",
      contextBefore: "",
      contextAfter: "",
      mode: "txt2img",
    })) {
      if (ev.type === "done") result = ev.result;
    }
    expect(result?.text).toBe("她站在窗边，光线柔和");
  });

  it("成人模式自动切到无限制档的模型", async () => {
    const { streamRewriteSelection } = await import("../prompt-rewrite");
    respond = ({ res }) => sse(res, [delta("ok")]);
    for await (const _ of streamRewriteSelection({
      skill: skillFromDefinition(OFFICIAL_SKILL_BY_KEY.get("polish")!),
      selection: "一句话",
      contextBefore: "",
      contextAfter: "",
      mode: "txt2img",
      allowSensitive: true,
    })) void _;

    // 基础档挂的是会拒答的模型，成人模式下用它只会得到「抱歉我无法协助」
    expect(lastBody.model).toBe("cognitivecomputations/dolphin-mistral-24b-venice-edition");
  });
});
