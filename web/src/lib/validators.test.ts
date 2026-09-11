import { describe, it, expect } from "vitest";
import { generationSchema, NORMAL_PROMPT_MAX, PROMPT_HARD_MAX } from "./validators";
import { promptCountState } from "./prompt-limits";

/**
 * 长度上限是**跨字段规则**（依赖 spicy），这类规则最容易写反：
 * 写反一边，正经的长分镜稿被拒；写反另一边，非 Spicy 档悄悄放行。
 * 两种都要到用户撞上才发现。
 */

const base = { mode: "txt2img" as const, prompt: "一只橘猫" };
const parse = (over: Record<string, unknown>) => generationSchema.safeParse({ ...base, ...over });

describe("提示词长度上限", () => {
  it("非 Spicy 档卡在 4000 字", () => {
    expect(parse({ prompt: "字".repeat(NORMAL_PROMPT_MAX) }).success).toBe(true);
    expect(parse({ prompt: "字".repeat(NORMAL_PROMPT_MAX + 1) }).success).toBe(false);
  });

  it("**Spicy 档不卡**——写多长都行", () => {
    expect(parse({ spicy: true, prompt: "字".repeat(NORMAL_PROMPT_MAX * 5) }).success).toBe(true);
  });

  it("不传 spicy 时按非 Spicy 算，不能靠省略字段绕过", () => {
    // spicy 有 default(false)，漏传不等于放行
    expect(parse({ prompt: "字".repeat(NORMAL_PROMPT_MAX + 1) }).success).toBe(false);
  });

  it("防滥用硬顶对两档都生效", () => {
    expect(parse({ spicy: true, prompt: "字".repeat(PROMPT_HARD_MAX + 1) }).success).toBe(false);
    expect(parse({ spicy: false, prompt: "字".repeat(PROMPT_HARD_MAX + 1) }).success).toBe(false);
  });

  it("超限时给的是中文说明，不是 zod 的英文原文", () => {
    const r = parse({ prompt: "字".repeat(NORMAL_PROMPT_MAX + 1) });
    expect(r.success).toBe(false);
    const message = r.success ? "" : r.error.issues[0].message;
    expect(message).toContain("4000");
    // 告诉用户出路在哪，否则他只知道「太长了」
    expect(message).toContain("Spicy");
  });

  it("报错挂在 prompt 字段上，不是挂在整个对象上", () => {
    const r = parse({ prompt: "字".repeat(NORMAL_PROMPT_MAX + 1) });
    expect(r.success ? [] : r.error.issues[0].path).toEqual(["prompt"]);
  });

  it("中文按一字一算，4000 字就是 4000 个汉字", () => {
    expect(parse({ prompt: "猫".repeat(4000) }).success).toBe(true);
    expect(parse({ prompt: "猫".repeat(4001) }).success).toBe(false);
  });
});

describe("字数提示什么时候出现", () => {
  const L = NORMAL_PROMPT_MAX;

  it("Spicy 档一个字都不显示", () => {
    // 挂个「1234 字」在那里只会让人以为也有上限
    expect(promptCountState(0, null)).toBe("hidden");
    expect(promptCountState(999_999, null)).toBe("hidden");
  });

  it("短提示词不显示——那时候显示字数是纯噪音", () => {
    expect(promptCountState(0, L)).toBe("hidden");
    expect(promptCountState(L / 2, L)).toBe("hidden");
  });

  it("过半之后开始显示", () => {
    expect(promptCountState(L / 2 + 1, L)).toBe("normal");
  });

  it("九成之后变警告色", () => {
    expect(promptCountState(L * 0.9, L)).toBe("normal");
    expect(promptCountState(L * 0.9 + 1, L)).toBe("warn");
  });

  it("**正好等于上限还不算超**——提交是放行的，颜色不该吓人", () => {
    expect(promptCountState(L, L)).toBe("warn");
    expect(generationSchema.safeParse({ ...base, prompt: "字".repeat(L) }).success).toBe(true);
  });

  it("超一个字就变红，与服务端的判定同一个边界", () => {
    expect(promptCountState(L + 1, L)).toBe("over");
    expect(generationSchema.safeParse({ ...base, prompt: "字".repeat(L + 1) }).success).toBe(false);
  });
});
