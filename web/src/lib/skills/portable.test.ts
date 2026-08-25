import { describe, it, expect } from "vitest";
import { portableSkillSchema, toPortable } from "./portable";
import { portableFileName } from "./portable-file";

const base = {
  key: "u-abc",
  name: "我的润色",
  nameEn: "",
  icon: "fa-pen",
  description: "",
  triggers: ["selection"],
  modes: [],
  systemPrompt: "任务：润色",
  userTemplate: "{{selection}}",
  outputMode: "replace",
  maxOutputTokens: 600,
  temperature: 0.4,
};

describe("技能导入导出格式", () => {
  it("导出的东西能原样导回来", () => {
    const parsed = portableSkillSchema.safeParse(toPortable(base));
    expect(parsed.success).toBe(true);
  });

  it("不带内部状态：没有 id / ownerId / isOverridden / isActive / sortOrder", () => {
    const keys = Object.keys(toPortable(base));
    for (const forbidden of ["id", "ownerId", "isOverridden", "isActive", "sortOrder", "scope"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("没有版本号的文件一律拒绝", () => {
    const { version: _drop, ...rest } = toPortable(base);
    void _drop;
    expect(portableSkillSchema.safeParse(rest).success).toBe(false);
  });

  it("未来版本的文件也拒绝，而不是当成 v1 读", () => {
    expect(portableSkillSchema.safeParse({ ...toPortable(base), version: 2 }).success).toBe(false);
  });

  it("用户绑不了还没实现的时机", () => {
    // 勾了只会造出一条永远不触发的技能，然后来问「为什么我的技能不工作」
    const bad = { ...toPortable(base), triggers: ["slash"] };
    expect(portableSkillSchema.safeParse(bad).success).toBe(false);
  });

  it("时机不能为空", () => {
    expect(portableSkillSchema.safeParse({ ...toPortable(base), triggers: [] }).success).toBe(false);
  });

  it("输出上限有硬顶，不能靠导入绕过", () => {
    const bad = { ...toPortable(base), max_output_tokens: 100000 };
    expect(portableSkillSchema.safeParse(bad).success).toBe(false);
  });

  it("官方技能里那些用户绑不了的时机，导出时被滤掉", () => {
    const official = { ...base, triggers: ["selection", "submit"] };
    expect(toPortable(official).triggers).toEqual(["selection"]);
  });

  it("选填字段有默认值，手写一个最小文件也能导入", () => {
    const minimal = {
      version: 1,
      name: "手写的",
      triggers: ["manual"],
      system_prompt: "任务：做点什么",
      user_template: "{{full_text}}",
    };
    const parsed = portableSkillSchema.safeParse(minimal);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.temperature).toBe(0.4);
    expect(parsed.success && parsed.data.modes).toEqual([]);
  });
});

describe("下载文件名", () => {
  it("洗掉路径分隔符与引号", () => {
    expect(portableFileName('../../etc/pa"sswd')).toBe("skill-etc-pa-sswd.json");
  });

  it("中文名保留", () => {
    expect(portableFileName("我的润色")).toBe("skill-我的润色.json");
  });

  it("全是符号时兜底", () => {
    expect(portableFileName("///")).toBe("skill-untitled.json");
  });
});
