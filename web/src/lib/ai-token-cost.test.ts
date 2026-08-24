import { describe, it, expect } from "vitest";
import { creditsForTokens, estimateTokens } from "./ai-token-cost";

describe("token 换算点数", () => {
  it("按费率线性换算并向上取整", () => {
    expect(creditsForTokens(1000, 1)).toBe(1);
    expect(creditsForTokens(1001, 1)).toBe(2);
    expect(creditsForTokens(2500, 2)).toBe(5);
  });

  /**
   * 没有下限的话，短句改写会算出 0 点 —— 等于开放一个免费无限调用大模型的入口。
   */
  it("再短也至少收 1 点", () => {
    expect(creditsForTokens(1, 1)).toBe(1);
    expect(creditsForTokens(50, 1)).toBe(1);
  });

  it("费率配成 0 表示本功能不收费", () => {
    expect(creditsForTokens(999999, 0)).toBe(0);
  });

  it("没有实际消耗就不收费", () => {
    expect(creditsForTokens(0, 1)).toBe(0);
    expect(creditsForTokens(Number.NaN, 1)).toBe(0);
  });
});

describe("兜底估算", () => {
  it("中文按一字一 token", () => {
    expect(estimateTokens("一只橘猫")).toBe(4);
  });

  it("英文按四字符一 token", () => {
    expect(estimateTokens("abcdefgh")).toBe(2);
  });

  it("中英混排各算各的", () => {
    // 4 个汉字 + 8 个英文字符 = 4 + 2
    expect(estimateTokens("一只橘猫abcdefgh")).toBe(6);
  });

  it("空串不产生消耗", () => {
    expect(estimateTokens("")).toBe(0);
  });

  /** 估算只会偏高不会偏低——宁可少收也不能因为估低而免费 */
  it("估算方向是向上取整", () => {
    expect(estimateTokens("abc")).toBe(1);
  });
});
