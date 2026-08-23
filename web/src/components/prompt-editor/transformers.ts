import { $createHeadingNode, $isHeadingNode, HeadingNode } from "@lexical/rich-text";
import { ORDERED_LIST, UNORDERED_LIST, type ElementTransformer } from "@lexical/markdown";

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

/** 分节标题在编辑器里长什么样。只有这一级 */
const HEADING_TAG = "h2" as const;

/**
 * 标题：`#`、`##`、`###` 都出同一级。
 *
 * 不做多级层级，因为**任何一级序列化出去都是同一个纯文本行**（符号丢弃）。
 * 做成三种视觉大小，等于在屏幕上画出一套存不下来、一保存就蒸发的层级，
 * 和上面拒绝加粗是同一个理由。三个前缀都认，纯粹是照顾肌肉记忆。
 */
export const SECTION_HEADING: ElementTransformer = {
  dependencies: [HeadingNode],
  export: (node, exportChildren) =>
    $isHeadingNode(node) ? `# ${exportChildren(node)}` : null,
  regExp: /^(#{1,6})\s/,
  replace: (parentNode, children, _match, isImport) => {
    const heading = $createHeadingNode(HEADING_TAG);
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

export { HEADING_TAG };
