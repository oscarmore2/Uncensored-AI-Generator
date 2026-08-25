import { describe, it, expect } from "vitest";
import { estimateTokens } from "./ai-token-cost";

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
