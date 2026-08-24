"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $insertNodes,
  $isRangeSelection,
} from "lexical";
import { $nodesFromText } from "./lexical-bridge";

/**
 * 选中一句 → 浮出动作 → 只替换这一句。
 *
 * 这是对 make 页那个「点一下把整段覆盖掉」的修正：决定之前原文一字不动，
 * 替换是一步撤销，改的永远只有用户圈出来的那一段。
 */

export type RewriteAction = "polish" | "localize" | "expand" | "shorten" | "emphasize";

export type SelectionAiLabels = {
  polish: string;
  localize: string;
  expand: string;
  shorten: string;
  emphasize: string;
  working: string;
  cancel: string;
  replace: string;
  insertBelow: string;
  retry: string;
  discard: string;
  droppedRefs: string;
  /** 本次扣了多少点。传函数而不是模板串，插值交给 i18n 自己做 */
  charged(credits: number): string;
};

export type SelectionAiRequest = (
  args: {
    action: RewriteAction;
    selection: string;
    contextBefore: string;
    contextAfter: string;
  },
  opts: {
    /** 用户点取消 / 组件卸载时中止 */
    signal: AbortSignal;
    /** 流式增量。**追加**显示，收到最终结果时整体替换 */
    onDelta(text: string): void;
  }
) => Promise<{ text: string; dropped: string[]; charged?: number }>;

/** 上下文各截多少字，与服务端 CONTEXT_CHARS 保持一致 */
const CONTEXT_CHARS = 300;

/** 窄于这个就把卡片钉到底部：浮在选区旁边会被选择手柄和键盘一起压住 */
const DOCK_WIDTH = 640;

type Phase =
  | { kind: "idle" }
  | { kind: "menu"; rect: DOMRect }
  /** 等结果 / 边流边显示。text 是已经流出来的部分 */
  | { kind: "pending"; rect: DOMRect; action: RewriteAction; text: string }
  | {
      kind: "preview";
      rect: DOMRect;
      action: RewriteAction;
      text: string;
      dropped: string[];
      charged?: number;
    }
  | { kind: "error"; rect: DOMRect; message: string };

export function SelectionAiPlugin({
  enabled = true,
  labels,
  request,
}: {
  enabled?: boolean;
  labels: SelectionAiLabels;
  /** 由外层注入，插件本身不认识 API 与模式参数 */
  request: SelectionAiRequest;
}) {
  const [editor] = useLexicalComposerContext();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  /** 发起那一刻的选区文本与上下文。等结果期间编辑器是只读的，所以它不会失效 */
  const shotRef = useRef<{ selection: string; before: string; after: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const dock = useDockToBottom();

  /* 组件被卸载（切页 / 收起弹窗）时把还在跑的请求掐掉 */
  useEffect(() => () => abortRef.current?.abort(), []);

  /* 选区变了就重新决定要不要显示动作条 */
  useEffect(() => {
    if (!enabled) return;
    return editor.registerUpdateListener(({ editorState }) => {
      // pending / preview 期间不跟随选区，否则结果卡会被自己的操作弹走
      setPhase((current) => {
        if (current.kind === "pending" || current.kind === "preview") return current;
        let next: Phase = { kind: "idle" };
        editorState.read(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || selection.isCollapsed()) return;
          if (!selection.getTextContent().trim()) return;
          const native = window.getSelection();
          const range = native && native.rangeCount > 0 ? native.getRangeAt(0) : null;
          const rect = range?.getBoundingClientRect();
          if (rect && rect.width + rect.height > 0) next = { kind: "menu", rect };
        });
        return next;
      });
    });
  }, [editor, enabled]);

  /** 抓取选区与前后文。必须在 editor.read 里调 */
  const snapshot = useCallback(() => {
    return editor.getEditorState().read(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return null;
      const whole = $getRoot().getTextContent();
      const picked = selection.getTextContent();
      /*
       * 用整段文本定位选区，而不是遍历节点算偏移。
       * 节点偏移在有胶囊（DecoratorNode）时算起来很容易差一位，
       * 而这里只需要「大致的前后文」，indexOf 足够且不会算错。
       */
      const at = whole.indexOf(picked);
      const before = at >= 0 ? whole.slice(Math.max(0, at - CONTEXT_CHARS), at) : "";
      const after = at >= 0 ? whole.slice(at + picked.length, at + picked.length + CONTEXT_CHARS) : "";
      return { selection: picked, before, after };
    });
  }, [editor]);

  const run = useCallback(
    async (action: RewriteAction, rect: DOMRect) => {
      const shot = shotRef.current ?? snapshot();
      if (!shot?.selection.trim()) return;
      shotRef.current = shot;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      /*
       * 等结果期间把编辑器锁成只读。
       *
       * 计划书要求「锚点失效」二选一：跟随位置映射，或锁住。锁住更诚实——
       * 跟随做不好会把结果替换到别的地方去，而那种错误用户很难发现。
       * 一次请求就几秒，锁住的代价可以接受。
       */
      editor.setEditable(false);
      setPhase({ kind: "pending", rect, action, text: "" });
      try {
        const result = await request(
          {
            action,
            selection: shot.selection,
            contextBefore: shot.before,
            contextAfter: shot.after,
          },
          {
            signal: controller.signal,
            onDelta(text) {
              setPhase((current) =>
                // 已经被取消或被别的动作顶掉了就别再往上贴字
                current.kind === "pending" && current.action === action
                  ? { ...current, text: current.text + text }
                  : current
              );
            },
          }
        );
        if (controller.signal.aborted) return;
        setPhase({
          kind: "preview",
          rect,
          action,
          /* 整体替换而不是追加：最终结果多跑了一次去壳，与流出来的那份会有出入 */
          text: result.text,
          dropped: result.dropped,
          charged: result.charged,
        });
      } catch (e) {
        if (controller.signal.aborted) return;
        // 就地报错。选区级操作下，错误飞到屏幕角落的 toast 里是不可接受的
        setPhase({ kind: "error", rect, message: e instanceof Error ? e.message : "改写失败" });
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        editor.setEditable(true);
      }
    },
    [editor, request, snapshot]
  );

  const finish = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    shotRef.current = null;
    editor.setEditable(true);
    setPhase({ kind: "idle" });
  }, [editor]);

  /** 替换选中那一段。整个替换是一步撤销 */
  const apply = useCallback(
    (text: string, mode: "replace" | "insert") => {
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        const { inline, nodes } = $nodesFromText(text);
        if (mode === "replace") {
          // 先清掉选中内容，再把新节点插进同一个位置
          selection.removeText();
          $insertNodes(nodes);
          return;
        }

        /*
         * 插入下方 = 插到选区**所在段落之后**，而不是光标后面。
         * 「补充细节」这类动作产出的是新的一句/一段，塞在光标处会把
         * 原来那句话从中间劈开。
         */
        const picked = selection.getNodes();
        const anchorBlock = picked[picked.length - 1]?.getTopLevelElement() ?? null;
        const block = anchorBlock ?? $getRoot().getLastChild();
        if (!block) return;

        if (inline) {
          const paragraph = $createParagraphNode();
          for (const node of nodes) paragraph.append(node);
          block.insertAfter(paragraph);
        } else {
          let cursor = block;
          for (const node of nodes) {
            cursor.insertAfter(node);
            cursor = node;
          }
        }
      });
      editor.focus();
      finish();
    },
    [editor, finish]
  );

  if (!enabled || phase.kind === "idle") return null;

  const rect = phase.rect;
  const style: React.CSSProperties = dock
    ? { left: 8, right: 8, bottom: dock.bottom, width: "auto" }
    : {
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 340)),
        top: rect.bottom + 8,
      };

  return createPortal(
    <div
      style={style}
      /* 不能让点击把编辑器的选区抢走，否则替换时找不到该替换哪一段 */
      onMouseDown={(e) => e.preventDefault()}
      className={`fixed z-[240] overflow-hidden rounded-2xl border border-line bg-surface shadow-xl ${
        dock ? "" : "w-[min(21rem,calc(100vw-1rem))]"
      }`}
    >
      {phase.kind === "menu" && (
        <div className="flex flex-wrap gap-1 p-1.5">
          {(
            [
              ["polish", "fa-wand-magic-sparkles", labels.polish],
              ["localize", "fa-language", labels.localize],
              ["expand", "fa-arrows-left-right-to-line", labels.expand],
              ["shorten", "fa-compress", labels.shorten],
              ["emphasize", "fa-bolt", labels.emphasize],
            ] as const
          ).map(([action, icon, label]) => (
            <button
              key={action}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                void run(action, rect);
              }}
              className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] text-ink-muted hover:bg-black/[0.05] hover:text-ink"
            >
              <i className={`fas ${icon} text-[11px]`} />
              {label}
            </button>
          ))}
        </div>
      )}

      {phase.kind === "pending" && (
        <div>
          {/* 边写边看。**这里不给替换按钮**：出口审查要等全文才能做，
              在那之前这段文字还没被判过，不能让用户提前放进正文 */}
          {phase.text && <ResultText text={phase.text} streaming />}
          <div className="flex items-center gap-2 px-3 py-2.5 text-[12px] text-ink-muted">
            <i className="fas fa-circle-notch fa-spin text-[11px]" />
            <span className="flex-1">{labels.working}</span>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                finish();
              }}
              className="rounded-lg border border-line px-2 py-1 text-[11px]"
            >
              {labels.cancel}
            </button>
          </div>
        </div>
      )}

      {phase.kind === "error" && (
        <div className="px-3 py-2.5">
          <p className="text-[12px] leading-relaxed text-red-700">{phase.message}</p>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              finish();
            }}
            className="mt-2 rounded-lg border border-line px-2 py-1 text-[11px]"
          >
            {labels.discard}
          </button>
        </div>
      )}

      {phase.kind === "preview" && (
        <div>
          {/* 决定之前原文一字不动，这里只是预览 */}
          <ResultText text={phase.text} />
          {phase.dropped.length > 0 && (
            <p className="border-b border-line bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-800">
              {labels.droppedRefs}：{phase.dropped.join("、")}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-1 p-1.5">
            <PreviewBtn primary onClick={() => apply(phase.text, "replace")} label={labels.replace} />
            <PreviewBtn onClick={() => apply(phase.text, "insert")} label={labels.insertBelow} />
            <PreviewBtn onClick={() => void run(phase.action, rect)} label={labels.retry} />
            <PreviewBtn onClick={finish} label={labels.discard} />
            {phase.charged != null && phase.charged > 0 && (
              /* 花了多少钱要当场说。等用户自己去流水里对账是最差的做法 */
              <span className="ml-auto pr-1.5 text-[11px] text-ink-subtle">
                {labels.charged(phase.charged)}
              </span>
            )}
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}

function ResultText({ text, streaming }: { text: string; streaming?: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  /* 流式时跟住最后一行，不然写长了用户只看得见开头 */
  useEffect(() => {
    if (streaming && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [text, streaming]);
  return (
    <div
      ref={ref}
      className="max-h-48 overflow-y-auto overscroll-contain border-b border-line px-3 py-2.5 text-[12px] leading-relaxed whitespace-pre-wrap break-words"
    >
      {text}
      {streaming && <span className="ml-0.5 inline-block h-3 w-[2px] animate-pulse bg-ink-muted align-middle" />}
    </div>
  );
}

/**
 * 窄屏把卡片钉到底部，并让开软键盘。
 *
 * 手机上浮在选区旁边是不能用的：那块位置正好被系统的选择手柄和放大镜占着，
 * 键盘弹起来之后还会把卡片顶到屏幕外。`visualViewport` 是唯一能问出
 * 「键盘占了多高」的接口——`window.innerHeight` 在 iOS 上键盘弹起时不变。
 *
 * 返回 null 表示宽屏，照旧跟着选区浮动。
 */
function useDockToBottom(): { bottom: number } | null {
  const [state, setState] = useState<{ bottom: number } | null>(null);

  useEffect(() => {
    const vv = window.visualViewport;
    const update = () => {
      if (window.innerWidth >= DOCK_WIDTH) {
        setState(null);
        return;
      }
      const inset = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
      setState({ bottom: inset + 8 });
    };
    update();
    window.addEventListener("resize", update);
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    return () => {
      window.removeEventListener("resize", update);
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
    };
  }, []);

  return state;
}

function PreviewBtn({
  onClick,
  label,
  primary,
}: {
  onClick(): void;
  label: string;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      className={`rounded-lg px-2.5 py-1.5 text-[12px] ${
        primary
          ? "bg-orange-700 font-semibold text-white"
          : "text-ink-muted hover:bg-black/[0.05] hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}
