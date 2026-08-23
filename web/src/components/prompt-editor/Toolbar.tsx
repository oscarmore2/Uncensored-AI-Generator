"use client";

import { useCallback, useEffect, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $setBlocksType } from "@lexical/selection";
import { $createHeadingNode, $isHeadingNode } from "@lexical/rich-text";
import {
  $isListNode,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
} from "@lexical/list";
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  type BaseSelection,
} from "lexical";
import { HEADING_TAG } from "./transformers";

/**
 * 结构工具条。
 *
 * markdown 快捷输入（敲 `# ` 变标题）已经有了，但**手机上那条路基本走不通**：
 * 中文输入法状态下要切英文才打得出 `#`，切回来接着写中文——为了一个标题
 * 来回切两次输入法，没人会用。所以按钮是移动端的主路径，快捷输入是桌面端的。
 *
 * 常显而不是选中才浮出：iOS Safari 一选中文字必弹系统菜单（拷贝/查询/翻译），
 * 浮动条会被盖住或者抢不到位置。安卓稍好但也会撞。
 *
 * 只有三个按钮，因为**能序列化的结构只有这三种**。工具条上不出现的东西，
 * 就是这套 schema 装不下的东西，两者必须严格一致——
 * 按钮比 schema 多一个，就是一个骗人的按钮。
 */

type BlockType = "paragraph" | "heading" | "ul" | "ol";

/**
 * 当前光标所在块是什么类型。
 *
 * 必须在 editor.read/update 里调。工具条的高亮和「再点一下取消」两处**都**走它，
 * 保证两者永远看到同一份事实。
 */
function $blockTypeOf(selection: BaseSelection | null): BlockType {
  if (!$isRangeSelection(selection)) return "paragraph";
  const anchor = selection.anchor.getNode();
  const top = anchor.getKey() === "root" ? anchor : anchor.getTopLevelElement();
  if ($isListNode(top)) return top.getListType() === "number" ? "ol" : "ul";
  if ($isHeadingNode(top)) return "heading";
  return "paragraph";
}

/**
 * 没有选区时把光标放到文末。
 *
 * 手机上很容易先点工具条、再点正文——那一刻编辑器从没获得过焦点，
 * 选区是 null，命令全部静默失败，按钮看着能按其实没反应。
 * 与其让它无声地什么都不做，不如先给一个合理的落点。
 */
function $ensureSelection(): BaseSelection | null {
  const current = $getSelection();
  if ($isRangeSelection(current)) return current;
  $getRoot().selectEnd();
  return $getSelection();
}

export function Toolbar({
  disabled,
  labels,
}: {
  disabled?: boolean;
  labels: { heading: string; bullet: string; ordered: string };
}) {
  const [editor] = useLexicalComposerContext();
  const [block, setBlock] = useState<BlockType>("paragraph");

  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => setBlock($blockTypeOf($getSelection())));
      }),
    [editor]
  );

  const toggleHeading = useCallback(() => {
    editor.update(() => {
      const selection = $ensureSelection();
      if (!$isRangeSelection(selection)) return;
      /* 当前类型在 update 内部现读，不用组件里那个 block state：
       * 后者由 registerUpdateListener 异步刷新，连点两下时它还停在上一轮，
       * 于是「取消标题」会被当成「设为标题」。 */
      const isHeading = $blockTypeOf(selection) === "heading";
      $setBlocksType(selection, () =>
        isHeading ? $createParagraphNode() : $createHeadingNode(HEADING_TAG)
      );
    });
  }, [editor]);

  const toggleList = useCallback(
    (kind: "ul" | "ol") => {
      // 列表走命令，命令内部自己找选区，所以这里只负责先把选区备好、再判当前值
      const current = editor.getEditorState().read(() => $blockTypeOf($getSelection()));
      if (current === "paragraph") editor.update(() => void $ensureSelection());
      if (current === kind) {
        editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
        return;
      }
      editor.dispatchCommand(
        kind === "ul" ? INSERT_UNORDERED_LIST_COMMAND : INSERT_ORDERED_LIST_COMMAND,
        undefined
      );
    },
    [editor]
  );

  return (
    <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="段落结构">
      <Button
        active={block === "heading"}
        disabled={disabled}
        onClick={toggleHeading}
        label={labels.heading}
        icon="fa-heading"
      />
      <Button
        active={block === "ul"}
        disabled={disabled}
        onClick={() => toggleList("ul")}
        label={labels.bullet}
        icon="fa-list-ul"
      />
      <Button
        active={block === "ol"}
        disabled={disabled}
        onClick={() => toggleList("ol")}
        label={labels.ordered}
        icon="fa-list-ol"
      />
    </div>
  );
}

function Button({
  active,
  disabled,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  disabled?: boolean;
  onClick(): void;
  label: string;
  icon: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={label}
      /* 在 mousedown 上就阻止默认行为，否则点按钮会先让编辑器失焦，
       * 选区随之丢失，$setBlocksType 拿到的是 null——按钮点了没反应。
       * PromptMentionBox 的菜单踩过同一个坑。 */
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`flex h-8 min-w-8 items-center justify-center rounded-lg border px-2 text-[12px] transition-colors disabled:opacity-40 ${
        active
          ? "border-orange-500/50 bg-orange-500/15 text-orange-800"
          : "border-line bg-surface text-ink-muted hover:bg-black/[0.04]"
      }`}
    >
      <i className={`fas ${icon}`} />
    </button>
  );
}
