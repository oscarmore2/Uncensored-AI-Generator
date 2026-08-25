/**
 * 技能模板的渲染。纯函数，好单测，也能在管理端做实时预览。
 *
 * 只有两种语法：
 *
 * - `{{name}}`：替换成值。
 * - `{{#name}}…{{/name}}`：值非空才输出这一段，为空整段丢掉。
 *
 * 第二个是规划 2.5 之外补的，因为不补不行：前后文经常是空的（选区就在开头
 * 或结尾），没有条件段的话模板里那句「【前文，仅供理解】」会带着一片空白
 * 照发给模型——模型会以为前文真的是空白，而不是「这次没有前文」。
 *
 * **未知变量原样保留**，不报错也不清空。作者写错一个名字时，
 * 让它原封不动出现在结果里，是最容易被发现的失败方式。
 */

export type TemplateVars = Record<string, string | undefined>;

/**
 * `{{#name}}…{{/name}}`，非贪婪，允许跨行。
 *
 * 末尾那个可选换行是**跟着段一起走的**：整段被丢掉时如果只删段不删换行，
 * 原地会留下一个空行，看起来像「这里本该有东西」。
 */
const SECTION_RE = /\{\{#([A-Za-z0-9_]+)\}\}([\s\S]*?)\{\{\/\1\}\}(\n?)/g;
const VAR_RE = /\{\{([A-Za-z0-9_]+)\}\}/g;

export function renderTemplate(template: string, vars: TemplateVars): string {
  // 先处理条件段：不然段内的变量会被先替换掉，就判断不出「这段该不该留」了
  const withSections = template.replace(
    SECTION_RE,
    (whole, name: string, body: string, eol: string) => {
      if (!(name in vars)) return whole; // 未知的照留，作者才看得见自己写错了
      return (vars[name] ?? "").trim() ? `${body}${eol}` : "";
    }
  );

  const filled = withSections.replace(VAR_RE, (whole, name: string) =>
    name in vars ? (vars[name] ?? "") : whole
  );

  return tidy(filled);
}

/**
 * 收拾空白。
 *
 * 条件段被丢掉之后会留下成片的空行，直接发给模型就是白烧 token，
 * 而且长段空白本身会被当成「这里有内容但被省略了」。
 */
export function tidy(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    // 行尾空格：模板里缩进对齐留下的，模型看不见但一样计费
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 模板里引用了哪些变量。管理端拿它做「这个技能用到了什么」的提示 */
export function variablesUsed(template: string): string[] {
  const found = new Set<string>();
  for (const m of template.matchAll(SECTION_RE)) found.add(m[1]);
  for (const m of template.matchAll(VAR_RE)) found.add(m[1]);
  return [...found].sort();
}
