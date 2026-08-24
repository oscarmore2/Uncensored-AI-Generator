import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { apiStream, ApiError } from "./client";

/**
 * 客户端消费 SSE 的那一半。
 *
 * 重点是**两种失败长得不一样**：流开始之前被挡下来（鉴权、限流、并发锁）
 * 回的是普通 JSON + 状态码；流开始之后才失败（出口审查拦截）时 HTTP 200
 * 早发出去了，错误只能以事件形式出现在流中间。搞混任何一种，用户看到的都是
 * 「请求失败 (429)」这类什么也没说的话。
 */

let server: Server;
let url: string;
let handler: (res: import("node:http").ServerResponse) => void;

beforeAll(async () => {
  server = createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => handler(res));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/prompts/rewrite`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("apiStream", () => {
  it("逐个交出事件", async () => {
    handler = (res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write('data: {"type":"delta","text":"光"}\n\n');
      res.write('data: {"type":"delta","text":"影"}\n\ndata: {"type":"done","text":"光影"}\n\n');
      res.end();
    };

    const seen: Record<string, unknown>[] = [];
    await apiStream(url, { method: "POST" }, (e) => seen.push(e));
    expect(seen).toEqual([
      { type: "delta", text: "光" },
      { type: "delta", text: "影" },
      { type: "done", text: "光影" },
    ]);
  });

  it("流开始之前的失败按 JSON 报错，保住 code 与文案", async () => {
    handler = (res) => {
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "上一个 AI 动作还在跑，请等它结束", code: "AI_BUSY" }));
    };

    await expect(apiStream(url, { method: "POST" }, () => {})).rejects.toMatchObject({
      status: 429,
      code: "AI_BUSY",
      message: "上一个 AI 动作还在跑，请等它结束",
    });
  });

  it("200 但不是 SSE 时也当失败，不静默返回", async () => {
    handler = (res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    };
    await expect(apiStream(url, { method: "POST" }, () => {})).rejects.toBeInstanceOf(ApiError);
  });

  it("坏事件跳过，不掐断后面的", async () => {
    handler = (res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write("data: not-json\n\ndata: {\"type\":\"done\"}\n\n");
      res.end();
    };
    const seen: Record<string, unknown>[] = [];
    await apiStream(url, { method: "POST" }, (e) => seen.push(e));
    expect(seen).toEqual([{ type: "done" }]);
  });

  it("最后一个事件没有空行收尾也收得到", async () => {
    handler = (res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end('data: {"type":"done","text":"收尾"}');
    };
    const seen: Record<string, unknown>[] = [];
    await apiStream(url, { method: "POST" }, (e) => seen.push(e));
    expect(seen).toEqual([{ type: "done", text: "收尾" }]);
  });
});
