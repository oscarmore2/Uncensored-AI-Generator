import { describe, it, expect } from "vitest";
import { maskPromptRefs, unmaskPromptRefs } from "./prompt-ref-guard";
import { refTokensInText } from "./prompt-doc";

describe("交给大模型改写时的引用保护", () => {
  it("遮罩后原文里不再有 @ 引用", () => {
    const { masked, tokens } = maskPromptRefs("女人参考 @Image1，背景参考 @Image2");
    expect(masked).toBe("女人参考 [[REF1]]，背景参考 [[REF2]]");
    expect(tokens).toEqual(["Image1", "Image2"]);
    expect(refTokensInText(masked)).toEqual([]);
  });

  it("同一个引用重复出现共用一个占位符", () => {
    const { masked, tokens } = maskPromptRefs("参考 @Image1，再参考 @Image1");
    expect(tokens).toEqual(["Image1"]);
    expect(masked).toBe("参考 [[REF1]]，再参考 [[REF1]]");
  });

  it("原样返回时能完整还原", () => {
    const src = "女人参考 @Image1，背景参考 @Video1";
    const { masked, tokens } = maskPromptRefs(src);
    const { text, missing } = unmaskPromptRefs(masked, tokens);
    expect(text).toBe(src);
    expect(missing).toEqual([]);
  });

  /**
   * 这条是本模块存在的核心理由：模型重排句子、把占位符贴在汉字后面。
   * 直接还原会得到「参考@Image1」——识别式不认，提交时不会被改写，
   * 会原样当成正文送进模型。
   */
  it("模型把占位符贴在汉字后面时，还原要补分隔符", () => {
    const { text, missing } = unmaskPromptRefs("女人打扮参考[[REF1]]的样子", ["Image1"]);
    expect(text).toBe("女人打扮参考 @Image1的样子");
    expect(missing).toEqual([]);
    // 补完之后必须真的认得出来
    expect(refTokensInText(text)).toEqual(["Image1"]);
  });

  it("占位符在句首时不多垫空格", () => {
    const { text } = unmaskPromptRefs("[[REF1]] 站在窗边", ["Image1"]);
    expect(text).toBe("@Image1 站在窗边");
    expect(refTokensInText(text)).toEqual(["Image1"]);
  });

  it("模型弄丢了引用要如实报出来，不猜着补回去", () => {
    const { text, missing } = unmaskPromptRefs("模型把引用整段删掉了", ["Image1", "Image2"]);
    expect(missing).toEqual(["Image1", "Image2"]);
    expect(text).toBe("模型把引用整段删掉了");
  });

  it("丢一半时只报丢掉的那一半", () => {
    const { text, missing } = unmaskPromptRefs("只剩 [[REF2]] 了", ["Image1", "Image2"]);
    expect(missing).toEqual(["Image1"]);
    expect(text).toBe("只剩 @Image2 了");
  });

  it("邮箱之类的假引用不参与遮罩", () => {
    const { masked, tokens } = maskPromptRefs("联系 name@image1.com");
    expect(tokens).toEqual([]);
    expect(masked).toBe("联系 name@image1.com");
  });
});
