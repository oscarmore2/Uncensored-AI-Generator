"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createParagraphNode,
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $insertNodes,
  $isRangeSelection,
  type LexicalNode,
} from "lexical";
import { $isHeadingNode } from "@lexical/rich-text";
import { serializePrompt } from "@/lib/prompt-doc";
import { $blockNodesFromDoc, $docFromNodes, $nodesFromText } from "./lexical-bridge";
import { parsePrompt } from "@/lib/prompt-doc";
import { levelFromTag } from "./transformers";
import { sectionRangeAt } from "./section";
import { computePlacement, EDGE, MIN_CARD_HEIGHT, type Placement } from "./placement";

/**
 * 选中一句 → 浮出动作 → 只替换这一句。
 *
 * 这是对 make 页那个「点一下把整段覆盖掉」的修正：决定之前原文一字不动，
 * 替换是一步撤销，改的永远只有用户圈出来的那一段。
 */

/**
 * 技能 key。**不再是封闭枚举**——技能是库里的行，管理端能加能停用，
 * 前端写死一份清单只会和库里那份对不上。
 */
export type RewriteAction = string;

/** 动作条上的一颗按钮。名称与图标都来自库，前端不再自己维护 */
export type SelectionAiSkill = {
  key: string;
  name: string;
  icon: string;
  description?: string;
  /**
   * `card` = 这次的输出**不是用来顶替原文的**（比如「这段有什么问题」）。
   * 只读展示，不给落地按钮——不然用户顺手一点，评语就写进提示词里了。
   */
  outputMode?: "replace" | "card";
  /** 空 = 所有层级。只对章节级技能有意义 */
  sectionLevels?: number[];
};

/**
 * 这次动作作用在哪一段。
 *
 * `selection` 是用户圈出来的那一段；`section` 是一个标题连同它下面所有块，
 * 直到下一个同级或更高级的标题。两者的**替换目标完全不同**，
 * 混用会把整章的结果盖到一句话上，或者反过来。
 */
type Scope =
  | { kind: "selection" }
  | { kind: "section"; keys: string[]; level: number; title: string };

export type SelectionAiLabels = {
  working: string;
  cancel: string;
  replace: string;
  insertBelow: string;
  retry: string;
  discard: string;
  droppedRefs: string;
  /** 只读结果的收起按钮 */
  done: string;
  /** 带了几张参考图。模型看没看见图，直接决定这次结果该怎么读 */
  images(count: number): string;
  /**
   * 本次消耗与累计零头。
   *
   * 两个数都得显示。只显示单次的话，用户会以为这功能免费（余额确实一直不动），
   * 等某次突然掉 1 点时会来投诉；只显示累计的话，又不知道刚才那一下花了多少。
   */
  charged(cost: string, debt: string): string;
  /** 零头攒满、真从余额里扣掉时才出现 */
  settled(credits: number): string;
};

/** 一次调用的花费。三个数都来自服务端，前端不做任何换算 */
export type SelectionAiCharge = {
  /** 本次消耗，点（可能是 0.031 这样的小数） */
  cost: string;
  /** 还没满 1 点的累计零头 */
  debt: string;
  /** 本次真正从余额扣掉的整点 */
  settled: number;
};

export type SelectionAiRequest = (
  args: {
    action: RewriteAction;
    /** 选区级还是章节级。服务端拿它校验技能确实绑了这个时机，并记进用量台账 */
    trigger: "selection" | "section";
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
) => Promise<{
  text: string;
  dropped: string[];
  charge?: SelectionAiCharge;
  /** 这次实际带上去的参考图张数 */
  images?: number;
}>;

/** 上下文各截多少字，与服务端 CONTEXT_CHARS 保持一致 */
const CONTEXT_CHARS = 300;

/** 窄于这个就把卡片钉到底部：浮在选区旁边会被选择手柄和键盘一起压住 */
const DOCK_WIDTH = 640;

/** 测不到实际宽度时的估值，与下面的 w-[min(21rem,…)] 对齐 */
const FALLBACK_WIDTH = 336;

type Phase =
  | { kind: "idle" }
  | { kind: "menu"; rect: DOMRect; scope: Scope }
  /** 等结果 / 边流边显示。text 是已经流出来的部分 */
  | { kind: "pending"; rect: DOMRect; scope: Scope; action: RewriteAction; text: string }
  /* 存的是技能而不是只存 key：拿到结果时要按它的 outputMode 决定给哪些按钮 */
  | {
      kind: "preview";
      rect: DOMRect;
      scope: Scope;
      action: RewriteAction;
      readOnly: boolean;
      text: string;
      dropped: string[];
      charge?: SelectionAiCharge;
      images: number;
    }
  | { kind: "error"; rect: DOMRect; message: string };

export function SelectionAiPlugin({
  enabled = true,
  labels,
  skills,
  sectionSkills = [],
  sectionBar,
  request,
}: {
  enabled?: boolean;
  labels: SelectionAiLabels;
  /** 章节级技能（section 时机）。按当前标题层级过滤后显示 */
  sectionSkills?: SelectionAiSkill[];
  /**
   * 章节按钮画在哪儿——编辑器上方那条工具栏里的一个空容器。
   * 用传送门而不是 context：工具栏在这个插件的**上面**，
   * 插件里 provide 的 context 包不住它。
   */
  sectionBar?: HTMLElement | null;
  /** 当前模式下可用的技能。空数组就不显示动作条 */
  skills: SelectionAiSkill[];
  /** 由外层注入，插件本身不认识 API 与模式参数 */
  request: SelectionAiRequest;
}) {
  const [editor] = useLexicalComposerContext();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  /** 发起那一刻的选区文本与上下文。等结果期间编辑器是只读的，所以它不会失效 */
  const shotRef = useRef<{ selection: string; before: string; after: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  /** 光标当前所在的章节。工具栏那排章节按钮跟着它变 */
  const [activeSection, setActiveSection] = useState<Scope | null>(null);
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
          if (rect && rect.width + rect.height > 0) {
            next = { kind: "menu", rect, scope: { kind: "selection" } };
          }
        });
        return next;
      });
    });
  }, [editor, enabled]);

  /*
   * 点标题弹出章节菜单。
   *
   * 走 DOM 的 click 而不是 Lexical 的 CLICK_COMMAND：要知道「点的是不是标题」，
   * 最直接的答案在 DOM 上（closest("h1,h2,h3")），绕回节点树反而更绕。
   */
  useEffect(() => {
    if (!enabled || sectionSkills.length === 0) return;
    const onClick = (event: MouseEvent) => {
      const el = (event.target as HTMLElement | null)?.closest?.("h1,h2,h3");
      if (!el) return;
      const rect = el.getBoundingClientRect();
      editor.getEditorState().read(() => {
        const scope = $sectionAt($getNearestNodeFromDOMNode(el));
        if (scope) setPhase({ kind: "menu", rect, scope });
      });
    };
    return editor.registerRootListener((root, prev) => {
      prev?.removeEventListener("click", onClick);
      root?.addEventListener("click", onClick);
    });
  }, [editor, enabled, sectionSkills.length]);

  /* 工具栏那排章节按钮要知道光标在哪一节 */
  useEffect(() => {
    if (!enabled) return;
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection();
        const node = $isRangeSelection(selection) ? selection.anchor.getNode() : null;
        setActiveSection($sectionAt(node));
      });
    });
  }, [editor, enabled]);

  /** 这次菜单该列哪些技能：选区级列选区技能，章节级按标题层级过滤 */
  const menuSkillsFor = useCallback(
    (scope: Scope) =>
      scope.kind === "section" ? levelSkills(sectionSkills, scope.level) : skills,
    [skills, sectionSkills]
  );

  /** 抓取要改的那一段与它的前后文。必须在 editor.read 里调 */
  const snapshot = useCallback(
    (scope: Scope) => {
      return editor.getEditorState().read(() => {
        if (scope.kind === "section") return $sectionShot(scope.keys);
        return $selectionShot();
      });
    },
    [editor]
  );

  const run = useCallback(
    async (action: RewriteAction, rect: DOMRect, scope: Scope) => {
      const shot = shotRef.current ?? snapshot(scope);
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
      setPhase({ kind: "pending", rect, scope, action, text: "" });
      try {
        const result = await request(
          {
            action,
            trigger: scope.kind,
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
          scope,
          action,
          readOnly:
            [...skills, ...sectionSkills].find((s) => s.key === action)?.outputMode === "card",
          /* 整体替换而不是追加：最终结果多跑了一次去壳，与流出来的那份会有出入 */
          text: result.text,
          dropped: result.dropped,
          charge: result.charge,
          images: result.images ?? 0,
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
    [editor, request, skills, sectionSkills, snapshot]
  );

  const finish = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    shotRef.current = null;
    editor.setEditable(true);
    setPhase({ kind: "idle" });
  }, [editor]);

  /** 把结果落到正文里。整个替换是一步撤销 */
  const apply = useCallback(
    (text: string, mode: "replace" | "insert", scope: Scope) => {
      if (scope.kind === "section") {
        editor.update(() => $applySection(scope.keys, text, mode));
        editor.focus();
        finish();
        return;
      }
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

  const placement = useCardPlacement(phase.kind === "idle" ? null : phase.rect, cardRef);

  if (!enabled) return null;

  /*
   * 章节按钮画进编辑器上方那条工具栏。它与浮动卡片是两套独立的出口：
   * 卡片跟着点击走，这一排跟着光标走，两者可以同时在。
   */
  const sectionRow =
    sectionBar && activeSection?.kind === "section"
      ? createPortal(
          <SectionRow
            title={activeSection.title}
            level={activeSection.level}
            skills={levelSkills(sectionSkills, activeSection.level)}
            disabled={phase.kind === "pending"}
            onPick={(key, el) => void run(key, el.getBoundingClientRect(), activeSection)}
          />,
          sectionBar
        )
      : null;

  if (phase.kind === "idle" || (phase.kind === "menu" && menuSkillsFor(phase.scope).length === 0)) {
    return sectionRow;
  }

  const rect = phase.rect;
  const style: React.CSSProperties = dock
    ? {
        left: EDGE,
        right: EDGE,
        bottom: dock.bottom,
        width: "auto",
        /* 底栏也要封顶：结果很长时它会一路往上长，盖住整个编辑区。
           bottom 已经让开了键盘，所以从布局视口高度里减掉那段就是可见高度 */
        maxHeight: `calc(100vh - ${dock.bottom + EDGE}px)`,
      }
    : {
        left: placement.left,
        /* above 按下边定位（卡片会随流式变高，按上边会一路长下来盖住选区）；
           below 与 viewport 都按上边 */
        ...(placement.anchor === "above"
          ? { bottom: placement.offset }
          : { top: placement.offset }),
        maxHeight: placement.maxHeight,
      };

  return (
    <>
      {sectionRow}
      {createPortal(
    <div
      ref={cardRef}
      style={style}
      /* 不能让点击把编辑器的选区抢走，否则替换时找不到该替换哪一段 */
      onMouseDown={(e) => e.preventDefault()}
      /* flex 列 + 下面那些 min-h-0，是为了空间不够时**先压扁正文而不是挤掉按钮**。
         按钮被挤出视口就等于这次改写作废了，用户点不到「替换」 */
      className={`fixed z-[240] flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-xl ${
        dock ? "" : "w-[min(21rem,calc(100vw-1rem))]"
      }`}
    >
      {phase.kind === "menu" && (
        <div className="flex flex-wrap gap-1 p-1.5">
          {menuSkillsFor(phase.scope).map((skill) => (
            <button
              key={skill.key}
              type="button"
              title={skill.description}
              onMouseDown={(e) => {
                e.preventDefault();
                void run(skill.key, rect, phase.scope);
              }}
              className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] text-ink-muted hover:bg-black/[0.05] hover:text-ink"
            >
              {skill.icon && <i className={`fas ${skill.icon} text-[11px]`} />}
              {skill.name}
            </button>
          ))}
        </div>
      )}

      {phase.kind === "pending" && (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* 边写边看。**这里不给替换按钮**：出口审查要等全文才能做，
              在那之前这段文字还没被判过，不能让用户提前放进正文 */}
          {phase.text && <ResultText text={phase.text} streaming />}
          <div className="flex shrink-0 items-center gap-2 px-3 py-2.5 text-[12px] text-ink-muted">
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
        <div className="flex min-h-0 flex-1 flex-col">
          {/* 决定之前原文一字不动，这里只是预览 */}
          <ResultText text={phase.text} />
          {phase.images > 0 && (
            /* 模型这次是照着图写的，还是全凭文字猜的——两种结果读法完全不同 */
            <p className="shrink-0 border-b border-line bg-sky-500/10 px-3 py-1.5 text-[11px] text-sky-800">
              <i className="fas fa-image mr-1" />
              {labels.images(phase.images)}
            </p>
          )}
          {phase.dropped.length > 0 && (
            <p className="shrink-0 border-b border-line bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-800">
              {labels.droppedRefs}：{phase.dropped.join("、")}
            </p>
          )}
          <div className="flex shrink-0 flex-wrap items-center gap-1 p-1.5">
            {/* 只读结果不给落地按钮：它回的不是用来顶替原文的东西 */}
            {!phase.readOnly && (
              <>
                <PreviewBtn
                  primary
                  onClick={() => apply(phase.text, "replace", phase.scope)}
                  label={labels.replace}
                />
                <PreviewBtn
                  onClick={() => apply(phase.text, "insert", phase.scope)}
                  label={labels.insertBelow}
                />
              </>
            )}
            <PreviewBtn
              onClick={() => void run(phase.action, rect, phase.scope)}
              label={labels.retry}
            />
            <PreviewBtn primary={phase.readOnly} onClick={finish} label={phase.readOnly ? labels.done : labels.discard} />
            {phase.charge && (
              /* 花了多少钱要当场说。等用户自己去流水里对账是最差的做法 */
              <span className="ml-auto pr-1.5 text-[11px] text-ink-subtle">
                {labels.charged(phase.charge.cost, phase.charge.debt)}
                {phase.charge.settled > 0 && ` · ${labels.settled(phase.charge.settled)}`}
              </span>
            )}
          </div>
        </div>
      )}
    </div>,
        document.body
      )}
    </>
  );
}

/** 这一级标题上该出现哪些技能。空 sectionLevels = 所有层级 */
function levelSkills(skills: SelectionAiSkill[], level: number): SelectionAiSkill[] {
  return skills.filter((s) => !s.sectionLevels?.length || s.sectionLevels.includes(level));
}

/** 编辑器上方那排章节按钮 */
function SectionRow({
  title,
  level,
  skills,
  disabled,
  onPick,
}: {
  title: string;
  level: number;
  skills: SelectionAiSkill[];
  disabled: boolean;
  onPick(key: string, el: HTMLElement): void;
}) {
  if (skills.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {/* 先说清楚这些按钮作用在哪一节，否则用户不知道「重写这一幕」是哪一幕 */}
      <span className="mr-1 max-w-[12rem] truncate text-[11px] text-ink-subtle">
        H{level} · {title || "（无标题）"}
      </span>
      {skills.map((skill) => (
        <button
          key={skill.key}
          type="button"
          disabled={disabled}
          title={skill.description}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => onPick(skill.key, e.currentTarget)}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-2 text-[12px] text-ink-muted hover:bg-black/[0.04] disabled:opacity-40"
        >
          {skill.icon && <i className={`fas ${skill.icon} text-[11px]`} />}
          {skill.name}
        </button>
      ))}
    </div>
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
      className="min-h-0 flex-1 max-h-48 overflow-y-auto overscroll-contain border-b border-line px-3 py-2.5 text-[12px] leading-relaxed whitespace-pre-wrap break-words"
    >
      {text}
      {streaming && <span className="ml-0.5 inline-block h-3 w-[2px] animate-pulse bg-ink-muted align-middle" />}
    </div>
  );
}

/**
 * 算卡片放哪儿，并且**保证它整个在视口里**。
 *
 * 原来是死板的「永远放选区下方」：选区一靠近视口底部，整张卡就掉出去了，
 * 正文还能看见一点，按钮已经在屏幕外——这次改写就等于作废，用户点不到「替换」。
 *
 * 算法在 `placement.ts` 里（纯函数，有单测）。这里只负责取实时坐标、
 * 挂监听、以及不必要时别 setState。
 */
function useCardPlacement(
  rect: DOMRect | null,
  cardRef: React.RefObject<HTMLDivElement | null>
): Placement {
  const [placement, setPlacement] = useState<Placement>({
    left: EDGE,
    anchor: "below",
    offset: EDGE,
    maxHeight: MIN_CARD_HEIGHT,
  });

  useLayoutEffect(() => {
    if (!rect) return;

    const compute = () => {
      /*
       * 每次都重新问一遍实时选区，而不是只用发起时存下的那个 rect：
       * 弹窗里的正文是可以滚动的，滚过之后存下来的坐标就指向别处了。
       * 问不到（选区没了）就退回存下的那份。
       */
      const selection = window.getSelection();
      const live =
        selection && selection.rangeCount > 0
          ? selection.getRangeAt(0).getBoundingClientRect()
          : null;
      const anchor = live && live.width + live.height > 0 ? live : rect;

      const next = computePlacement({
        anchor: { left: anchor.left, top: anchor.top, bottom: anchor.bottom },
        /* 固定定位是相对布局视口的，这里不能混用 visualViewport——那个留给窄屏底栏 */
        viewport: { width: window.innerWidth, height: window.innerHeight },
        cardWidth: cardRef.current?.offsetWidth || FALLBACK_WIDTH,
      });

      setPlacement((current) =>
        current.left === next.left &&
        current.anchor === next.anchor &&
        current.offset === next.offset &&
        current.maxHeight === next.maxHeight
          ? current
          : next
      );
    };

    compute();
    window.addEventListener("resize", compute);
    // capture：正文是在某个内层容器里滚的，冒泡阶段收不到它的 scroll
    window.addEventListener("scroll", compute, true);
    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
    };
  }, [rect, cardRef]);

  return placement;
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


/** 选区 + 前后各 300 字。必须在 editor.read 里调 */
function $selectionShot(): { selection: string; before: string; after: string } | null {
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
}

/**
 * 整章 + 前后各 300 字。必须在 editor.read 里调。
 *
 * 取的是 **canonical 文本**（`serializePrompt`）而不是 `getTextContent()`：
 * 后者不带井号，模型看不到层级，回来的东西也就不带标题——一次「重写这一幕」
 * 会把标题吃掉。
 */
function $sectionShot(keys: string[]): { selection: string; before: string; after: string } | null {
  const children = $getRoot().getChildren();
  const start = children.findIndex((c) => c.getKey() === keys[0]);
  if (start < 0) return null;
  const end = start + keys.length;

  const textOf = (nodes: LexicalNode[]) => serializePrompt($docFromNodes(nodes));
  return {
    selection: textOf(children.slice(start, end)),
    before: textOf(children.slice(0, start)).slice(-CONTEXT_CHARS),
    after: textOf(children.slice(end)).slice(0, CONTEXT_CHARS),
  };
}

/**
 * 光标（或某个节点）所在的章节。必须在 editor.read 里调。
 *
 * 范围算法在 `section.ts` 里（纯函数，有单测）：一个标题连同它下面所有块，
 * 直到下一个**同级或更高级**的标题。子标题不切断父章节。
 */
function $sectionAt(node: LexicalNode | null): Scope | null {
  const children = $getRoot().getChildren();
  const levels = children.map((c) => ($isHeadingNode(c) ? levelFromTag(c.getTag()) : null));
  const top = node ? (node.getTopLevelElement() ?? node) : null;
  const index = top ? children.findIndex((c) => c.getKey() === top.getKey()) : -1;
  const range = sectionRangeAt(levels, index);
  if (!range) return null;
  const slice = children.slice(range.start, range.end);
  return {
    kind: "section",
    keys: slice.map((c) => c.getKey()),
    level: levels[range.start] as number,
    title: children[range.start].getTextContent(),
  };
}


/** 结果永远当块级插入：章节动作产出的是若干段，不是一句话 */
function $blocksFromText(text: string) {
  return $blockNodesFromDoc(parsePrompt(text));
}

/**
 * 用结果替换掉整章，或插在整章之后。必须在 editor.update 里调。
 *
 * 先插新的、再删旧的——顺序反过来的话，删到只剩空文档时 Lexical 会自己补一个
 * 空段落，新内容就插到它后面去了，正文顶上凭空多一行空行。
 */
function $applySection(keys: string[], text: string, mode: "replace" | "insert") {
  const nodes = $blocksFromText(text);
  if (nodes.length === 0) return;

  const olds = keys.map((k) => $getNodeByKey(k)).filter((n): n is LexicalNode => n !== null);
  const last = olds[olds.length - 1];
  if (!last) return;

  let cursor: LexicalNode = last;
  for (const node of nodes) {
    cursor.insertAfter(node);
    cursor = node;
  }
  if (mode === "replace") for (const old of olds) old.remove();
}
