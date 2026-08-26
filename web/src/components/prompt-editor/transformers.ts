import { $createHeadingNode, $isHeadingNode, HeadingNode } from "@lexical/rich-text";
import { ORDERED_LIST, UNORDERED_LIST, type ElementTransformer } from "@lexical/markdown";
import { MAX_HEADING_LEVEL, type HeadingLevel } from "@/lib/prompt-doc";

/**
 * 允许的 markdown 快捷输入 —— **一份白名单，不是把库里的默认值拿来用**。
 *
 * 默认那套 TRANSFORMERS 里带加粗、斜体、行内代码、引用块、删除线。
 * 这里一个都不要：上游没有一个模型认识 `**`。用户敲出来的加粗只有三种
 * 结局——星号原样进提示词污染语义、被静默丢掉、或者让用户以为强调生效了。
 * 三种都是骗人。想强调的需求是真的，出口是 AI 动作「加重这一句」，
 * 用语言手段实现，按钮不撒谎。
 *
 * 于是只剩下真能序列化的三样：分节标题、无序列表、有序列表。
 */

export type HeadingTag = "h1" | "h2" | "h3";

const TAGS: Record<HeadingLevel, HeadingTag> = { 1: "h1", 2: "h2", 3: "h3" };

export function tagForLevel(level: HeadingLevel): HeadingTag {
  return TAGS[level] ?? "h2";
}

export function levelFromTag(tag: string): HeadingLevel {
  const n = Number(tag.replace(/^h/i, ""));
  if (n >= 1 && n <= MAX_HEADING_LEVEL) return n as HeadingLevel;
  return 2;
}

/**
 * 标题：`#` / `##` / `###` 分别是一、二、三级。
 *
 * 以前三个前缀都出同一级，理由是「符号序列化时会丢，画出来的层级存不下来」。
 * 现在符号跟着一起序列化了（见 prompt-doc 的 serializeBlock），层级是真的：
 * 存得下、认得回、章节级 AI 也是按它分组的。
 *
 * `####` 起不认——doc 只到三级，认了就得往下压一级，那等于用户敲的东西
 * 被悄悄改了。留成正文更诚实。
 */
export const SECTION_HEADING: ElementTransformer = {
  dependencies: [HeadingNode],
  export: (node, exportChildren) =>
    $isHeadingNode(node)
      ? `${"#".repeat(levelFromTag(node.getTag()))} ${exportChildren(node)}`
      : null,
  regExp: /^(#{1,3})\s/,
  replace: (parentNode, children, match, isImport) => {
    const heading = $createHeadingNode(tagForLevel(match[1].length as HeadingLevel));
    heading.append(...children);
    parentNode.replace(heading);
    if (!isImport) heading.select(0, 0);
  },
  type: "element",
  // 行尾按回车也能触发，不必非得补一个空格
  triggerOnEnter: true,
};

/** 编辑器实际启用的全部快捷输入 */
export const PROMPT_TRANSFORMERS = [SECTION_HEADING, UNORDERED_LIST, ORDERED_LIST];
