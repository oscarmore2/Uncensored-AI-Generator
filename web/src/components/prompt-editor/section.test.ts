import { describe, it, expect } from "vitest";
import { sectionRangeAt } from "./section";

/** 用 H1/H2/- 画出文档结构，读起来比一串 null 清楚 */
function levels(shape: string): Array<number | null> {
  return shape.split("").map((c) => (c === "-" ? null : Number(c)));
}

describe("章节范围", () => {
  it("标题 + 它下面的正文，到下一个同级标题为止", () => {
    // 一级 正文 正文 | 一级 正文 正文
    expect(sectionRangeAt(levels("1--1--"), 0)).toEqual({ start: 0, end: 3 });
  });

  it("光标在正文里时，属于上面那个标题的章节", () => {
    expect(sectionRangeAt(levels("1--1--"), 2)).toEqual({ start: 0, end: 3 });
  });

  it("下一个是更深一级的标题时不截断——那是子节，属于本节", () => {
    expect(sectionRangeAt(levels("1--2--"), 0)).toEqual({ start: 0, end: 6 });
  });

  it("**子标题不切断父章节**", () => {
    // 「重写这一幕」应该连子节一起，而不是只到第一个 ## 为止
    expect(sectionRangeAt(levels("1-2-2-1-"), 0)).toEqual({ start: 0, end: 6 });
  });

  it("点子标题时只取子章节", () => {
    expect(sectionRangeAt(levels("1-2-2-1-"), 2)).toEqual({ start: 2, end: 4 });
  });

  it("同级标题互相截断", () => {
    expect(sectionRangeAt(levels("2-2-"), 0)).toEqual({ start: 0, end: 2 });
  });

  it("更高级的标题也截断", () => {
    expect(sectionRangeAt(levels("2-1-"), 0)).toEqual({ start: 0, end: 2 });
  });

  it("最后一节一直到文末", () => {
    expect(sectionRangeAt(levels("1-2---"), 2)).toEqual({ start: 2, end: 6 });
  });

  it("第一个标题之前的内容不属于任何章节", () => {
    expect(sectionRangeAt(levels("--1-"), 0)).toBeNull();
    expect(sectionRangeAt(levels("--1-"), 1)).toBeNull();
  });

  it("整篇没有标题就没有章节", () => {
    expect(sectionRangeAt(levels("----"), 2)).toBeNull();
  });

  it("越界返回 null", () => {
    expect(sectionRangeAt(levels("1-"), -1)).toBeNull();
    expect(sectionRangeAt(levels("1-"), 9)).toBeNull();
    expect(sectionRangeAt([], 0)).toBeNull();
  });

  it("只有一个标题、后面什么都没有", () => {
    expect(sectionRangeAt(levels("1"), 0)).toEqual({ start: 0, end: 1 });
  });

  it("三级混排：点二级时不吞掉后面的三级以外的东西", () => {
    // 1 - 2 - 3 - 2 -
    expect(sectionRangeAt(levels("1-2-3-2-"), 2)).toEqual({ start: 2, end: 6 });
  });
});
