import { describe, it, expect } from "vitest";
import { renderTemplate, tidy, variablesUsed } from "./template";

describe("技能模板渲染", () => {
  it("替换已知变量", () => {
    expect(renderTemplate("改写：{{selection}}", { selection: "她站在窗边" })).toBe(
      "改写：她站在窗边"
    );
  });

  it("未知变量原样保留——作者写错名字要看得见", () => {
    expect(renderTemplate("{{selction}} 与 {{selection}}", { selection: "对的" })).toBe(
      "{{selction}} 与 对的"
    );
  });

  it("已知但为空的变量替换成空", () => {
    expect(renderTemplate("[{{context_before}}]", { context_before: "" })).toBe("[]");
  });

  it("条件段：有值就留", () => {
    const t = "{{#context_before}}【前文】\n{{context_before}}{{/context_before}}\n【片段】\n{{selection}}";
    expect(renderTemplate(t, { context_before: "开场。", selection: "她站在窗边" })).toBe(
      "【前文】\n开场。\n【片段】\n她站在窗边"
    );
  });

  it("条件段：没值就整段丢掉，不留下孤零零的标题", () => {
    const t = "{{#context_before}}【前文】\n{{context_before}}{{/context_before}}\n【片段】\n{{selection}}";
    // 留着「【前文】」加一片空白，模型会以为前文真的是空白
    expect(renderTemplate(t, { context_before: "   ", selection: "她站在窗边" })).toBe(
      "【片段】\n她站在窗边"
    );
  });

  it("多个条件段互不干扰", () => {
    const t =
      "{{#a}}A={{a}}{{/a}}\n{{#b}}B={{b}}{{/b}}\n{{#c}}C={{c}}{{/c}}";
    expect(renderTemplate(t, { a: "1", b: "", c: "3" })).toBe("A=1\nC=3");
  });

  it("未知的条件段也原样保留", () => {
    expect(renderTemplate("{{#nope}}x{{/nope}}", {})).toBe("{{#nope}}x{{/nope}}");
  });

  it("段内的变量不会先被替换掉而影响判断", () => {
    // 如果先替换变量，段内就只剩空文本，「该不该留」的依据就没了
    expect(renderTemplate("{{#a}}[{{a}}]{{/a}}", { a: "" })).toBe("");
  });

  it("丢掉条件段留下的成片空行会被收拢", () => {
    const t = "头\n\n{{#gone}}中间{{/gone}}\n\n尾";
    expect(renderTemplate(t, { gone: "" })).toBe("头\n\n尾");
  });

  it("值里带 {{ 不会被二次展开", () => {
    // 不然用户在提示词里写 {{selection}} 这几个字就会被当成模板注入
    expect(renderTemplate("{{a}}", { a: "{{b}}", b: "炸了" })).toBe("{{b}}");
  });
});

describe("收拾空白", () => {
  it("行尾空格与超过两行的空行都清掉", () => {
    expect(tidy("  a  \n\n\n\n b \n")).toBe("a\n\n b");
  });
});

describe("列出用到的变量", () => {
  it("变量和条件段都算", () => {
    expect(variablesUsed("{{#ctx}}{{ctx}}{{/ctx}} {{selection}}")).toEqual(["ctx", "selection"]);
  });
});
