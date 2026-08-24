import { describe, it, expect } from "vitest";
import { createSseParser, splitEmittable } from "./sse";

describe("SSE 解析", () => {
  it("一个 chunk 里的多个事件全部切出来", () => {
    const p = createSseParser();
    expect(p.feed('data: {"a":1}\n\ndata: {"a":2}\n\n')).toEqual(['{"a":1}', '{"a":2}']);
  });

  it("事件被 chunk 边界劈开时不丢也不错", () => {
    const p = createSseParser();
    // 这是流式最常见的真实情况：TCP 给什么就是什么，不会照着事件边界断
    expect(p.feed("data: {\"con")).toEqual([]);
    expect(p.feed('tent":"你好"}')).toEqual([]);
    expect(p.feed("\n\n")).toEqual(['{"content":"你好"}']);
  });

  it("认 \\r\\n 分隔（有的网关会带回车）", () => {
    const p = createSseParser();
    expect(p.feed('data: {"a":1}\r\n\r\n')).toEqual(['{"a":1}']);
  });

  it("忽略注释与非 data 行", () => {
    const p = createSseParser();
    expect(p.feed(': keep-alive\n\nevent: ping\ndata: {"a":1}\n\n')).toEqual(['{"a":1}']);
  });

  it("同一事件的多行 data 拼成一条", () => {
    const p = createSseParser();
    expect(p.feed("data: line1\ndata: line2\n\n")).toEqual(["line1\nline2"]);
  });

  it("流结束时缓冲里没收尾的事件由 flush 补上", () => {
    const p = createSseParser();
    expect(p.feed("data: [DONE]")).toEqual([]);
    expect(p.flush()).toEqual(["[DONE]"]);
    expect(p.flush()).toEqual([]);
  });
});

describe("半截占位符扣留", () => {
  it("尾巴像占位符前缀就扣住", () => {
    for (const tail of ["[", "[[", "[[R", "[[RE", "[[REF", "[[REF1", "[[REF12", "[[REF1]"]) {
      expect(splitEmittable(`光线柔和${tail}`)).toEqual({ emit: "光线柔和", hold: tail });
    }
  });

  it("占位符写完就立刻放行", () => {
    expect(splitEmittable("光线柔和 [[REF1]]")).toEqual({ emit: "光线柔和 [[REF1]]", hold: "" });
  });

  it("不像占位符的左括号不扣留", () => {
    // 模型写 [cinematic lighting] 是常事，扣住它会让画面卡住不动
    expect(splitEmittable("镜头 [cinematic")).toEqual({ emit: "镜头 [cinematic", hold: "" });
  });

  it("只看最后一个左括号，前面写完的照放", () => {
    expect(splitEmittable("[[REF1]] 与 [[")).toEqual({ emit: "[[REF1]] 与 ", hold: "[[" });
  });

  it("没有左括号时全放", () => {
    expect(splitEmittable("一句普通的话")).toEqual({ emit: "一句普通的话", hold: "" });
  });
});
