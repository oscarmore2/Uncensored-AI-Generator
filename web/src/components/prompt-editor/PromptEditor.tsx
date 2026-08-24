"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ListItemNode, ListNode } from "@lexical/list";
import { HeadingNode } from "@lexical/rich-text";
import {
  $createTextNode,
  $getSelection,
  $insertNodes,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_LOW,
  PASTE_COMMAND,
  type LexicalEditor,
  type LexicalNode,
  type PasteCommandType,
  type RangeSelection,
} from "lexical";
import {
  parsePastedText,
  parsePrompt,
  refNeedsSeparator,
  sanitizePromptText,
  serializePrompt,
  type PromptDoc,
} from "@/lib/prompt-doc";
import {
  $applyDoc,
  $blockNodesFromDoc,
  $docFromEditor,
} from "./lexical-bridge";
import {
  $createMediaRefNode,
  MediaRefNode,
  MediaRefProvider,
  type MediaRefContextValue,
} from "./MediaRefNode";
import { PROMPT_TRANSFORMERS } from "./transformers";
import { Toolbar } from "./Toolbar";
import { MentionPlugin, type RefTarget } from "./MentionPlugin";
import {
  SelectionAiPlugin,
  type RewriteAction,
  type SelectionAiLabels,
} from "./SelectionAiPlugin";

/**
 * 真 WYSIWYG 提示词编辑器。
 *
 * **刻意不做成受控组件。** 受控（value/onChange 每次都把外部字符串写回
 * 编辑器）在中文输入法下是灾难：拼音还没上屏，一次 onChange 把 editorState
 * 整棵换掉，composition 被打断，表现是打一半的拼音突然消失或者重复上屏。
 * 所以这里只在挂载时读一次 initialText，之后内容的权威在编辑器自己手里，
 * 通过 onChangeText 往外吐 canonical。外部想强行改内容必须换 reloadKey，
 * 那是显式的、低频的（套模板、恢复草稿、原文视图落地）。
 */

export type PromptEditorHandle = {
  /** 素材栏的「引用」按钮走这条，往光标处插一颗胶囊 */
  insertRef(token: string, hint?: string | null): void;
  /** 当前内容的 canonical 文本 */
  getText(): string;
  focus(): void;
};

const THEME = {
  paragraph: "mb-3 last:mb-0",
  heading: { h2: "mb-2 mt-4 text-[1.15em] font-semibold first:mt-0" },
  list: {
    ul: "mb-3 list-disc pl-5",
    ol: "mb-3 list-decimal pl-5",
    listitem: "mb-1",
  },
};

export function PromptEditor({
  initialText,
  reloadKey,
  onChangeText,
  refContext,
  placeholder,
  className = "",
  ariaLabel,
  handle,
  structure = true,
  disabled,
  targets = [],
  labels,
  ai,
}: {
  initialText: string;
  /** 变了就把 initialText 重新灌进去。不变时外部改 initialText 无效——这是有意的 */
  reloadKey?: string | number;
  onChangeText(canonical: string): void;
  refContext: MediaRefContextValue;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  handle?: { current: PromptEditorHandle | null };
  /**
   * 是否提供结构编辑（标题 / 列表）。
   *
   * 按 formatId 关掉：文生图规则原话是「避免长段落叙事」，
   * 那个模式下给标题和列表按钮，等于鼓励用户写出会让出图变差的东西。
   * 关掉时快捷输入也一并停用，否则敲 `- ` 照样变列表，按钮藏了也没用。
   */
  structure?: boolean;
  disabled?: boolean;
  /** 可 @ 引用的素材 */
  targets?: RefTarget[];
  labels: {
    heading: string;
    bullet: string;
    ordered: string;
    mentionHeader: string;
    mentionEmpty: string;
    mentionNavigate: string;
    mentionSelect: string;
    mentionClose: string;
  };
  /**
   * 选区级 AI。不传就不挂——插件本身不认识 API，也不认识模式与档位，
   * 那些由外层注入。这样编辑器组件不必知道生成业务的任何事。
   */
  ai?: {
    labels: SelectionAiLabels;
    request(args: {
      action: RewriteAction;
      selection: string;
      contextBefore: string;
      contextAfter: string;
    }): Promise<{ text: string; dropped: string[] }>;
  };
}) {
  const initialConfig = useMemo(
    () => ({
      namespace: "prompt",
      theme: THEME,
      nodes: [HeadingNode, ListNode, ListItemNode, MediaRefNode],
      onError(error: Error) {
        // 吞掉会让编辑器进入静默半坏状态，比直接崩还难查
        throw error;
      },
      editorState: (editor: LexicalEditor) => {
        editor.update(() => $applyDoc(parsePrompt(initialText)));
      },
    }),
    // 只在挂载时算一次：initialText 后续变化由 reloadKey 走显式重载
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <MediaRefProvider value={refContext}>
        {structure && (
          <div className="mb-2 shrink-0 border-b border-line pb-2">
            <Toolbar
              disabled={disabled}
              labels={{ heading: labels.heading, bullet: labels.bullet, ordered: labels.ordered }}
            />
          </div>
        )}
        <div className={`relative ${className}`}>
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                aria-label={ariaLabel}
                className="min-h-full w-full resize-none outline-none"
                /* 中文输入法要靠这两条才不会被浏览器的自动纠正掺一脚 */
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
              />
            }
            placeholder={
              <div className="pointer-events-none absolute inset-x-0 top-0 select-none text-ink-subtle">
                {placeholder}
              </div>
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
          <HistoryPlugin />
          <ListPlugin />
          <OnChangePlugin
            /* 只在内容真变了时回调。选区移动也会触发 onChange，
             * 不过滤的话光标一动就当成一次编辑，草稿会被疯狂打点 */
            ignoreSelectionChange
            onChange={(editorState) => {
              const canonical = editorState.read(() => serializePrompt($docFromEditor()));
              onChangeText(canonical);
            }}
          />
          {structure && <MarkdownShortcutPlugin transformers={PROMPT_TRANSFORMERS} />}
          <MentionPlugin
            targets={targets}
            labels={{
              header: labels.mentionHeader,
              empty: labels.mentionEmpty,
              navigate: labels.mentionNavigate,
              select: labels.mentionSelect,
              close: labels.mentionClose,
            }}
          />
          {ai && <SelectionAiPlugin enabled={!disabled} labels={ai.labels} request={ai.request} />}
          <EditablePlugin disabled={disabled} />
          <PastePlugin />
          <ReloadPlugin text={initialText} reloadKey={reloadKey} />
          <HandlePlugin handle={handle} />
        </div>
      </MediaRefProvider>
    </LexicalComposer>
  );
}

/**
 * 粘贴走白名单降级。
 *
 * 只取 text/plain，然后过 parsePastedText——顺带把 `- ` 认成列表、
 * 把零宽字符和 NBSP 清掉。富文本的字号颜色之类一律丢弃，
 * 因为本 schema 里根本没有能装它们的地方，留着只会变成看不见的脏字符。
 */
function PastePlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(
    () =>
      editor.registerCommand(
        PASTE_COMMAND,
        (event: PasteCommandType) => {
          /* PASTE_COMMAND 的载荷可能是 ClipboardEvent、InputEvent 或
           * KeyboardEvent（安卓输入法的「粘贴」走的常常不是 ClipboardEvent）。
           * 拿不到 clipboardData 就原样交回默认行为，别把粘贴功能吃掉。 */
          const clipboard = "clipboardData" in event ? event.clipboardData : null;
          const raw = clipboard?.getData("text/plain");
          if (!raw) return false;
          event.preventDefault();

          const doc = parsePastedText(raw);
          editor.update(() => {
            const selection = $getSelection();
            if (!$isRangeSelection(selection)) return;
            const nodes = $blockNodesFromDoc(doc);
            if (nodes.length) $insertNodes(nodes);
          });
          return true;
        },
        COMMAND_PRIORITY_LOW
      ),
    [editor]
  );

  return null;
}

/** disabled 时把编辑器切成只读。Lexical 没有 disabled 属性，只有 editable */
function EditablePlugin({ disabled }: { disabled?: boolean }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editor.setEditable(!disabled);
  }, [editor, disabled]);
  return null;
}

/** reloadKey 变了才重灌内容。见组件顶上关于「不做受控」的说明 */
function ReloadPlugin({ text, reloadKey }: { text: string; reloadKey?: string | number }) {
  const [editor] = useLexicalComposerContext();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return; // 挂载时 initialConfig 已经灌过一次了
    }
    editor.update(() => $applyDoc(parsePrompt(text)));
    // text 不进依赖：只有 reloadKey 变才重灌
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, reloadKey]);

  return null;
}

function HandlePlugin({ handle }: { handle?: { current: PromptEditorHandle | null } }) {
  const [editor] = useLexicalComposerContext();

  const insertRef = useCallback(
    (token: string, hint?: string | null) => {
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;

        /* 前后各垫一个空格——但只在真的需要时垫。
         * 紧贴前一个词写 @Image1 会被识别式漏掉（详见 refNeedsSeparator），
         * 而无条件垫又会在已有空格的地方留下双空格。 */
        const nodes: LexicalNode[] = [];
        if (refNeedsSeparator($textAround(selection).before)) nodes.push($createTextNode(" "));
        nodes.push($createMediaRefNode(token, hint ?? null));
        const after = $textAround(selection).after;
        if (after && !/^\s/.test(after)) nodes.push($createTextNode(" "));
        $insertNodes(nodes);
      });
      // 插完把焦点还给编辑器，用户能接着往下打
      editor.focus();
    },
    [editor]
  );

  useEffect(() => {
    if (!handle) return;
    handle.current = {
      insertRef,
      getText: () => editor.getEditorState().read(() => serializePrompt($docFromEditor())),
      focus: () => editor.focus(),
    };
    return () => {
      handle.current = null;
    };
  }, [editor, handle, insertRef]);

  return null;
}

/**
 * 光标两侧最近的那点文字。只用来判断要不要垫空格，所以各取几个字符就够。
 *
 * 注意 MediaRefNode.getTextContent() 返回的是 @Image1，末尾是数字、
 * 不是分隔符，于是「胶囊后面紧接着插胶囊」会被正确判成需要垫空格。
 */
function $textAround(selection: RangeSelection): { before: string; after: string } {
  const anchor = selection.anchor;
  const node = anchor.getNode();

  let before = "";
  let after = "";
  if ($isTextNode(node)) {
    const text = node.getTextContent();
    before = text.slice(0, anchor.offset);
    after = text.slice(anchor.offset);
  }

  let prev = node.getPreviousSibling();
  while (!before && prev) {
    before = prev.getTextContent();
    prev = prev.getPreviousSibling();
  }
  let next = node.getNextSibling();
  while (!after && next) {
    after = next.getTextContent();
    next = next.getNextSibling();
  }

  return { before: before.slice(-4), after: after.slice(0, 4) };
}

/** 给外部用：不进编辑器也能算出一段文本的 canonical 形式 */
export function canonicalOf(text: string): string {
  return serializePrompt(parsePrompt(sanitizePromptText(text)));
}

export type { PromptDoc };
