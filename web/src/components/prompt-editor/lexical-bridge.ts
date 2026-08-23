import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isLineBreakNode,
  $isParagraphNode,
  $isTextNode,
  type ElementNode,
} from "lexical";
import {
  $createListItemNode,
  $createListNode,
  $isListItemNode,
  $isListNode,
} from "@lexical/list";
import { $createHeadingNode, $isHeadingNode } from "@lexical/rich-text";
import { $createMediaRefNode, $isMediaRefNode } from "./MediaRefNode";
import type { BlockNode, InlineNode, PromptDoc } from "@/lib/prompt-doc";

/**
 * Lexical 的节点树与 prompt-doc 的 doc 之间的翻译。
 *
 * 分成两个文件是有意的：prompt-doc.ts 不认识 Lexical，所以序列化规则能被
 * 单测直接跑、也能在服务端复用；本文件只做「树换树」，不含任何空白规则、
 * 不含任何引用识别式。哪天换编辑器库，要改的只有这一个文件。
 *
 * 带 $ 前缀的函数是 Lexical 的约定：**必须在 editor.read() / editor.update()
 * 的回调里调用**，在外面调会读到过期状态。
 */

function inlineFrom(node: ElementNode): InlineNode[] {
  const out: InlineNode[] = [];
  for (const child of node.getChildren()) {
    if ($isMediaRefNode(child)) {
      out.push({ type: "ref", token: child.getToken() });
    } else if ($isLineBreakNode(child)) {
      out.push({ type: "br" });
    } else if ($isTextNode(child)) {
      const text = child.getTextContent();
      const prev = out[out.length - 1];
      // 相邻 TextNode 合并：Lexical 会因为格式、IME、撤销点等原因把一段文字
      // 切成好几个 TextNode，不合并的话 doc 里全是碎片，比较起来不稳
      if (prev?.type === "text") prev.text += text;
      else out.push({ type: "text", text });
    } else {
      // schema 之外的节点：只把文字捞出来，结构丢掉（白名单降级）
      out.push({ type: "text", text: child.getTextContent() });
    }
  }
  return out;
}

/** 当前编辑器内容 -> doc。必须在 editor.read/update 里调 */
export function $docFromEditor(): PromptDoc {
  const blocks: BlockNode[] = [];
  for (const child of $getRoot().getChildren()) {
    if ($isHeadingNode(child)) {
      blocks.push({ type: "heading", children: inlineFrom(child) });
    } else if ($isListNode(child)) {
      const items = child
        .getChildren()
        .filter($isListItemNode)
        // 嵌套列表不在 schema 里：ListItemNode 套 ListNode 时只取它的文字，
        // 层级丢掉。序列化本来也表达不了缩进列表
        .map((item) => inlineFrom(item));
      blocks.push({ type: "list", ordered: child.getListType() === "number", items });
    } else if ($isParagraphNode(child)) {
      blocks.push({ type: "paragraph", children: inlineFrom(child) });
    } else {
      blocks.push({ type: "paragraph", children: [{ type: "text", text: child.getTextContent() }] });
    }
  }
  return { blocks };
}

function appendInline(parent: ElementNode, nodes: InlineNode[]) {
  for (const n of nodes) {
    switch (n.type) {
      case "text":
      case "literal":
        parent.append($createTextNode(n.text));
        break;
      case "br":
        parent.append($createLineBreakNode());
        break;
      case "ref":
        parent.append($createMediaRefNode(n.token));
        break;
      case "slot":
        // 槽位节点是 P2 的活。现在退化成它的填充值，语义不变（序列化本就输出值）
        if (n.value) parent.append($createTextNode(n.value));
        break;
      case "note":
        // 注释节点是 P4 的活。canonical 里本来就没有它，走到这里说明
        // doc 是内存里造的；剔除与序列化行为一致
        break;
    }
  }
}

/**
 * doc -> 一串块级节点。粘贴要用它（在光标处插入若干块），
 * 整体加载也用它。
 */
export function $blockNodesFromDoc(doc: PromptDoc): ElementNode[] {
  const out: ElementNode[] = [];
  for (const block of doc.blocks) {
    switch (block.type) {
      case "paragraph": {
        const p = $createParagraphNode();
        appendInline(p, block.children);
        out.push(p);
        break;
      }
      case "heading": {
        const h = $createHeadingNode("h2");
        appendInline(h, block.children);
        out.push(h);
        break;
      }
      case "list": {
        const list = $createListNode(block.ordered ? "number" : "bullet");
        for (const item of block.items) {
          const li = $createListItemNode();
          appendInline(li, item);
          list.append(li);
        }
        out.push(list);
        break;
      }
      case "note":
      case "divider":
        // 编辑器还造不出这两种块（P4），canonical 里也没有它们
        break;
    }
  }
  return out;
}

/** doc -> 编辑器内容（整棵替换）。必须在 editor.update 里调 */
export function $applyDoc(doc: PromptDoc) {
  const root = $getRoot();
  root.clear();
  for (const node of $blockNodesFromDoc(doc)) root.append(node);

  // Lexical 的根节点不能是空的，否则光标无处可落、点进去打不了字
  if (root.getChildrenSize() === 0) root.append($createParagraphNode());
}
