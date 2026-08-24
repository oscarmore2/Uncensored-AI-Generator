import { describe, it, expect } from "vitest";
import { looksChinese, stripWrapper } from "./prompt-rewrite-text";

describe("中英方向判断", () => {
  it("中文片段判为中文", () => {
    expect(looksChinese("一只橘猫坐在窗台上，午后阳光")).toBe(true);
  });

  it("英文片段判为非中文", () => {
    expect(looksChinese("an orange cat on the windowsill, afternoon light")).toBe(false);
  });

  /** 中文界面的用户完全可能在写英文提示词——那是常见做法，不能按界面语言判 */
  it("中英混排里以中文为主时判为中文", () => {
    expect(looksChinese("电影感光影 cinematic")).toBe(true);
  });

  it("混排里以英文为主时判为非中文", () => {
    expect(looksChinese("cinematic lighting with soft shadows and shallow depth 感")).toBe(false);
  });

  it("纯符号或空串不算中文", () => {
    expect(looksChinese("")).toBe(false);
    expect(looksChinese("123 --- ***")).toBe(false);
  });
});

/**
 * 这些壳会原样进提示词：用户看不出问题，生成模型却会把它们当正文读。
 */
describe("剥掉模型加的壳", () => {
  it("代码块", () => {
    expect(stripWrapper("```\n一只橘猫\n```")).toBe("一只橘猫");
    expect(stripWrapper("```text\n一只橘猫\n```")).toBe("一只橘猫");
  });

  it("中英文前缀", () => {
    expect(stripWrapper("改写后：一只橘猫")).toBe("一只橘猫");
    expect(stripWrapper("结果: 一只橘猫")).toBe("一只橘猫");
    expect(stripWrapper("Rewritten: an orange cat")).toBe("an orange cat");
  });

  it("整段被引号包住", () => {
    expect(stripWrapper('"一只橘猫"')).toBe("一只橘猫");
    expect(stripWrapper("「一只橘猫」")).toBe("一只橘猫");
  });

  /** 片段里本来就有引号（台词、对白）是用户写的内容，绝不能动 */
  it("内部引号不动", () => {
    const line = '她说"你是谁"然后转身';
    expect(stripWrapper(line)).toBe(line);
  });

  it("正常片段原样返回", () => {
    expect(stripWrapper("一只橘猫坐在窗台上")).toBe("一只橘猫坐在窗台上");
  });

  it("占位符不受影响", () => {
    expect(stripWrapper("```\n参考 [[REF1]] 的光线\n```")).toBe("参考 [[REF1]] 的光线");
  });
});
