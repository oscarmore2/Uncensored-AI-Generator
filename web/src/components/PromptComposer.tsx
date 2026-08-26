"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { RefTarget } from "./prompt-editor/targets";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import dynamic from "next/dynamic";
import type { PromptEditorHandle } from "./prompt-editor/PromptEditor";
import type { MediaRefContextValue } from "./prompt-editor/MediaRefNode";
import type {
  SelectionAiRequest,
  SelectionAiSkill,
} from "./prompt-editor/SelectionAiPlugin";

/*
 * 编辑器必须 ssr:false 且按需加载，两个理由都硬：
 *
 * 1. contenteditable 在服务端渲染出来是个空壳，hydrate 时才填内容，首屏会跳一下。
 * 2. Lexical 一整套（core + list + rich-text + markdown + selection）约 100KB。
 *    静态引入会把它塞进 /make 的首屏包——而 /make 是本站最主要的落地页，
 *    实测首屏 JS 从 147KB 涨到 248KB。提示词框在首屏之下、且要等用户点进去才用，
 *    没有理由让它挡住首屏。
 */
const PromptEditor = dynamic(
  () => import("./prompt-editor/PromptEditor").then((m) => m.PromptEditor),
  {
    ssr: false,
    // 骨架的高度与最终一致，避免加载完成时布局跳动
    loading: () => <div className="min-h-[88px] animate-pulse rounded-xl bg-black/[0.04]" />,
  }
);

/**
 * 提示词输入区：常态是一个输入框，点放大进弹窗。
 *
 * 弹窗里多出一条素材栏。参考生视频这类模式常常要在一长段描述里反复点名
 * 「这句说的是哪一份素材」，而素材缩略图在页面下方——写着写着就得往下翻，
 * 数第几张，翻回来接着写。把素材摆在编辑区旁边，一点就插进光标处。
 *
 * 版式随屏幕方向变，因为两种方向的瓶颈不同：
 * - **横屏**：宽度富余、高度紧张。左右分栏，编辑区和素材栏各自滚动——
 *   素材翻到底不该把正在写的段落顶走。
 * - **竖屏**：宽度紧张。上下堆叠，并且**只保留一条统一的纵向滚动**。
 *   窄屏上嵌套滚动区是灾难：手指往下划，到底命中哪一层要靠猜。
 *
 * 桌面端悬停素材出两个按钮：眼睛看大图、箭头直接引用。
 * 触屏没有 hover，所以两个按钮常显。
 */

/* 站点顶栏是 sticky z-50。弹窗必须压过它——否则被盖住的正好是弹窗自己的
 * 标题栏，预览和关闭两个按钮都在那一行，用户会以为功能不存在。
 * 120 这一档与模板弹窗同层，素材大图再高一档盖住它。 */
const Z_MODAL = "z-[120]";
const Z_MEDIA_DIALOG = "z-[130]";

/** 素材分区的固定顺序，与提交顺序一致 */
const KIND_ORDER = ["image", "video", "audio"] as const;

const KIND_ICON: Record<RefTarget["kind"], string> = {
  image: "fa-image",
  video: "fa-film",
  audio: "fa-music",
};

export function PromptComposer({
  value,
  onChange,
  targets,
  placeholder,
  className,
  disabled,
  structure = true,
  reloadKey,
  onRewrite,
  skills,
}: {
  value: string;
  onChange: (next: string) => void;
  targets: RefTarget[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /**
   * 是否给结构编辑（标题 / 列表）。文生图关掉——那套规则明写「避免长段落叙事」，
   * 给了按钮等于鼓励用户写出会让出图变差的东西。
   */
  structure?: boolean;
  /**
   * 外部把 value 换掉时（套模板、恢复草稿、复用作品、魔法指令）必须把它加一。
   *
   * 编辑器是**非受控**的——不这样它收不到外部的改动。反过来，用户自己打字
   * 引起的 value 变化绝不能动它，否则每敲一个字就重灌一次编辑器，
   * 中文输入法的候选还没上屏就被打断。
   */
  reloadKey?: string | number;
  /**
   * 选区级 AI 的实际请求。由 make 页注入——它才知道当前模式、档位、spicy。
   * 不传就不显示动作条。
   */
  onRewrite?: SelectionAiRequest;
  /**
   * 当前模式下可用的技能。由 make 页从 /api/skills 取——名称与图标都在库里，
   * 前端不再自己维护一份清单，否则管理端停用一个技能，按钮还在。
   */
  skills?: SelectionAiSkill[];
}) {
  const t = useTranslations("Make");
  const [expanded, setExpanded] = useState(false);
  const [preview, setPreview] = useState<RefTarget | null>(null);
  /* 预览只是**排版辅助**：上行的始终是原始文本，与编辑器逐字节一致 */
  const [previewing, setPreviewing] = useState(false);

  const inlineHandle = useRef<PromptEditorHandle | null>(null);
  const modalHandle = useRef<PromptEditorHandle | null>(null);

  /*
   * 常态和弹窗里是**两个独立的编辑器实例**，各自持有自己的 editorState。
   * 关掉弹窗时要把常态那个重新灌一遍，否则它还停在打开弹窗之前的内容上。
   *
   * 为什么不做成一个受控组件两处共用：受控（每次 onChange 把外部字符串写回
   * 编辑器）在中文输入法下会打断 composition，拼音打一半会消失。
   * 见 PromptEditor 顶上的说明。
   */
  const [syncKey, setSyncKey] = useState(0);

  useBodyScrollLock(expanded);

  const kindLabel: Record<RefTarget["kind"], string> = {
    image: t("mentionKindImage"),
    video: t("mentionKindVideo"),
    audio: t("mentionKindAudio"),
  };

  /* 按类型分组。只列出真有素材的那几类——模型能收什么素材各不相同，
   * 空着的分区留在那里只会让人以为该传却传不了。 */
  const groups = KIND_ORDER.map((kind) => ({
    kind,
    items: targets.filter((target) => target.kind === kind),
  })).filter((group) => group.items.length > 0);

  /** 关弹窗。必须走这里，好把常态编辑器同步成弹窗里的最新内容 */
  const collapse = useCallback(() => {
    setExpanded(false);
    setSyncKey((k) => k + 1);
  }, []);

  /* 引用落到当前可见的那个编辑器上：弹窗开着就是弹窗里那个 */
  const insert = useCallback(
    (target: RefTarget) => {
      const h = expanded ? modalHandle.current : inlineHandle.current;
      // 带上 url 作为 hint：日后素材顺序变了才报得出「所指已变」
      h?.insertRef(target.token, target.url);
    },
    [expanded]
  );

  /**
   * 胶囊要展示什么、能换绑到哪儿，全从当前 targets 现算。
   * targets 变了（换模式丢了媒体、拖动排序）胶囊自己就会重画，
   * editorState 一个字节都不用动。
   */
  const refContext: MediaRefContextValue = useMemo(
    () => ({
      resolve: (token) => {
        const hit = targets.find((x) => x.token === token);
        return hit ? { url: hit.url, kind: hit.kind, name: hit.name } : null;
      },
      options: () => targets.map((x) => ({ token: x.token, kind: x.kind, url: x.url, name: x.name })),
      labels: {
        orphan: t("refOrphan"),
        drifted: t("refDrifted"),
        rebind: t("refRebind"),
      },
    }),
    [targets, t]
  );

  const ai = useMemo(
    () =>
      onRewrite
        ? {
            request: onRewrite,
            skills: skills ?? [],
            labels: {
              working: t("aiWorking"),
              cancel: t("aiCancel"),
              replace: t("aiReplace"),
              insertBelow: t("aiInsertBelow"),
              retry: t("aiRetry"),
              discard: t("aiDiscard"),
              done: t("aiDone"),
              droppedRefs: t("aiDroppedRefs"),
              charged: (cost: string, debt: string) => t("aiCharged", { cost, debt }),
              settled: (credits: number) => t("aiSettled", { credits }),
            },
          }
        : undefined,
    [onRewrite, skills, t]
  );

  const editorLabels = useMemo(
    () => ({
      heading: t("structHeading"),
      bullet: t("structBullet"),
      ordered: t("structOrdered"),
      mentionHeader: t("mentionHeader"),
      mentionEmpty: t("mentionNoMatch"),
      mentionNavigate: t("mentionNavigate"),
      mentionSelect: t("mentionSelect"),
      mentionClose: t("mentionClose"),
    }),
    [t]
  );

  /*
   * Esc 的处理顺序：素材大图 → 弹窗。
   * defaultPrevented 是关键：@ 菜单开着时 Lexical 的 typeahead 会先吃掉 Esc
   * 并 preventDefault，这里就不能再把整个弹窗关掉——否则用户按一下 Esc
   * 想收起菜单，结果整段编辑区都消失了。
   */
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (preview) setPreview(null);
      else collapse();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [expanded, preview, collapse]);

  const citeMedia = useCallback(
    (target: RefTarget) => {
      /* 窄屏预览态下编辑器是藏起来的，没有光标可插，先切回编辑 */
      setPreviewing((on) => (window.innerWidth < 1024 ? false : on));
      requestAnimationFrame(() => insert(target));
    },
    [insert]
  );

  return (
    <>
      <div className="relative">
        <div className={className}>
          <PromptEditor
            initialText={value}
            /* 两个来源都要能触发重灌：外部换文本，以及弹窗关闭时的回灌 */
            reloadKey={`${reloadKey ?? 0}:${syncKey}`}
            onChangeText={onChange}
            refContext={refContext}
            targets={targets}
            labels={editorLabels}
            handle={inlineHandle}
            structure={structure}
            disabled={disabled}
            ai={ai}
            placeholder={placeholder}
            ariaLabel={t("prompt")}
            className="min-h-[88px]"
          />
        </div>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          disabled={disabled}
          aria-label={t("promptExpand")}
          title={t("promptExpand")}
          className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-xl border border-line bg-surface/90 text-ink-subtle backdrop-blur transition-colors hover:border-orange-500/40 hover:text-ink disabled:opacity-40"
        >
          <i className="fas fa-expand text-xs" />
        </button>
      </div>

      {expanded && (
        <div
          className={`fixed inset-0 ${Z_MODAL} overflow-auto bg-black/45`}
          role="dialog"
          aria-modal="true"
          aria-label={t("promptExpand")}
        >
          {/*
           * 外层可滚 + 这一层 min-h-full 居中：放得下就居中，放不下就整块弹窗
           * 跟着背板一起滚。纯 flex 居中在溢出时会把顶部裁掉且滚不到，
           * 而高度是 vh 算出来的，移动端地址栏收放、软键盘弹出都会让它算错——
           * 留这条退路比赌视口高度稳。
           */}
          <div
            className="flex min-h-full items-center justify-center p-0 sm:p-4 lg:p-6"
            onMouseDown={(e) => {
              // 只有点在背板上才关；点内部拖选到框外松手不该把弹窗关掉
              if (e.target === e.currentTarget) collapse();
            }}
          >
          {/*
           * 高度留一截余量、不满打满算：贴边的弹窗看不出是浮层，
           * 横屏手机上顶到边还会与系统手势区打架。
           *
           * min-h / min-w 是下限：窗口再小也不跟着缩了。缩到一定程度，
           * 标题栏、编辑区、素材栏会一起挤成谁都用不了的样子，
           * 不如让它溢出、交给背板滚——横屏手机（高 ~390）就属于这种。
           */}
          <div className="flex h-dvh min-h-[480px] w-full min-w-[320px] max-w-3xl flex-col overflow-hidden rounded-none border-line bg-stage shadow-2xl sm:h-[88dvh] sm:rounded-3xl sm:border lg:landscape:max-w-6xl">
            <div className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3 sm:px-5">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{t("promptExpandTitle")}</div>
                <div className="truncate text-[11px] text-ink-subtle">
                  {targets.length ? t("mentionHint") : t("mentionUploadFirst")}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPreviewing((v) => !v)}
                aria-pressed={previewing}
                className={`shrink-0 rounded-xl border px-3 py-2 text-xs transition-colors ${
                  previewing
                    ? "border-orange-500/50 bg-orange-500/10 text-ink"
                    : "border-line bg-surface text-ink-muted hover:text-ink"
                }`}
              >
                <i className={`fas ${previewing ? "fa-pen" : "fa-eye"} mr-1.5`} />
                {previewing ? t("promptEditMode") : t("promptCanonical")}
              </button>
              <button
                type="button"
                onClick={collapse}
                aria-label={t("promptCollapse")}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line bg-surface text-ink-subtle hover:text-ink"
              >
                <i className="fas fa-compress text-xs" />
              </button>
            </div>

            {/* 竖屏：整块一条纵向滚动。横屏：不滚，交给左右两栏各自滚 */}
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain md:landscape:flex-row md:landscape:overflow-hidden">
              <div className="flex shrink-0 flex-col gap-3 p-4 sm:p-5 md:landscape:min-h-0 md:landscape:flex-1 md:landscape:shrink md:landscape:overflow-hidden lg:landscape:flex-row">
                {/* 预览开着且屏幕够宽时两栏并排、实时联动；窄屏没地方并排，
                    就让预览顶掉编辑器（编辑器只是藏起来，选区和滚动位置都还在） */}
                <div
                  className={`flex min-h-0 flex-col md:landscape:flex-1 lg:landscape:flex-1 ${
                    previewing ? "max-lg:hidden" : ""
                  }`}
                >
                  <div className="flex h-[46vh] min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface p-4 text-sm focus-within:border-orange-500/60 md:landscape:h-auto md:landscape:flex-1">
                    <PromptEditor
                      /* 每次开弹窗都是新实例，挂载时读到的就是最新的 value。
                       * reloadKey 管的是弹窗**开着的时候**外部换了文本（魔法指令）。 */
                      initialText={value}
                      reloadKey={reloadKey}
                      onChangeText={onChange}
                      refContext={refContext}
                      targets={targets}
                      labels={editorLabels}
                      handle={modalHandle}
                      structure={structure}
                      disabled={disabled}
                      ai={ai}
                      placeholder={placeholder}
                      ariaLabel={t("prompt")}
                      className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
                    />
                  </div>
                </div>

                {previewing && (
                  <div className="flex min-h-0 flex-col md:landscape:flex-1">
                    {/*
                      原文视图。真 WYSIWYG 之后这里**不能再是排版预览**了——
                      编辑器本身就是排版，再放一份渲染结果没有任何信息量。
                      用户真正看不到的是「胶囊到底会写成什么」，所以这里显示
                      canonical：离开编辑器的就是这一字不差的字符串。
                    */}
                    <pre className="h-[46vh] overflow-auto overscroll-contain whitespace-pre-wrap break-words rounded-2xl border border-line bg-surface p-4 font-mono text-[12px] leading-relaxed md:landscape:h-auto md:landscape:min-h-0 md:landscape:flex-1">
                      {value}
                    </pre>
                    <p className="mt-2 shrink-0 text-[11px] text-ink-subtle">
                      <i className="fas fa-circle-info mr-1" />
                      {t("promptRawNote")}
                    </p>
                  </div>
                )}
              </div>

              {groups.length > 0 && (
                <div className="shrink-0 border-t border-line bg-surface/50 p-4 sm:p-5 md:landscape:w-[268px] md:landscape:overflow-y-auto md:landscape:overscroll-contain md:landscape:border-l md:landscape:border-t-0">
                  <div className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">
                    {t("mentionHeader")}
                  </div>
                  <div className="flex flex-col gap-4">
                    {groups.map((group) => (
                      <section key={group.kind}>
                        <div className="mb-2 flex items-center gap-2 border-b border-line pb-1.5 text-[11px] font-semibold text-ink-muted">
                          <i className={`fas ${KIND_ICON[group.kind]} text-[10px]`} />
                          <span>{kindLabel[group.kind]}</span>
                          <span className="ml-auto font-mono text-[10px] text-ink-subtle">
                            {group.items.length}
                          </span>
                        </div>
                        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:landscape:grid-cols-3">
                          {group.items.map((target) => (
                            <MediaTile
                              key={`${target.token}-${target.url}`}
                              target={target}
                              onPreview={() => setPreview(target)}
                              onInsert={() => citeMedia(target)}
                              previewLabel={t("promptMediaPreview")}
                              insertLabel={t("promptMediaCite")}
                            />
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          </div>
        </div>
      )}

      {preview && (
        <MediaPreviewDialog
          target={preview}
          onClose={() => setPreview(null)}
          onInsert={() => {
            citeMedia(preview);
            setPreview(null);
          }}
        />
      )}
    </>
  );
}

function MediaTile({
  target,
  onPreview,
  onInsert,
  previewLabel,
  insertLabel,
}: {
  target: RefTarget;
  onPreview: () => void;
  onInsert: () => void;
  previewLabel: string;
  insertLabel: string;
}) {
  return (
    <div className="group relative aspect-square overflow-hidden rounded-2xl border border-line bg-stage">
      <Thumb target={target} />

      <span className="absolute left-1 top-1 rounded-full bg-black/70 px-1.5 font-mono text-[9px] font-semibold text-white">
        {target.token}
      </span>

      {/* 桌面端悬停/聚焦才出；触屏没有 hover，常显 */}
      <div className="absolute inset-x-0 bottom-0 flex justify-center gap-1.5 p-1.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
        <button
          type="button"
          onClick={onPreview}
          aria-label={previewLabel}
          title={previewLabel}
          className="flex h-6 w-6 items-center justify-center rounded-full bg-black/75 text-[10px] text-white hover:bg-black/90"
        >
          <i className="fas fa-eye" />
        </button>
        <button
          type="button"
          onClick={onInsert}
          aria-label={insertLabel}
          title={insertLabel}
          className="flex h-6 w-6 items-center justify-center rounded-full bg-orange-700 text-[10px] text-white hover:bg-orange-600"
        >
          <i className="fas fa-arrow-right" />
        </button>
      </div>
    </div>
  );
}

function MediaPreviewDialog({
  target,
  onClose,
  onInsert,
}: {
  target: RefTarget;
  onClose: () => void;
  onInsert: () => void;
}) {
  const t = useTranslations("Make");
  return (
    <div
      className={`fixed inset-0 ${Z_MEDIA_DIALOG} flex items-center justify-center bg-black/70 p-4`}
      role="dialog"
      aria-modal="true"
      aria-label={target.name}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-line bg-stage shadow-2xl">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div className="min-w-0">
            <span className="rounded bg-black/[0.06] px-1.5 py-px font-mono text-[11px] font-semibold text-ink">
              {target.token}
            </span>
            <div className="mt-0.5 truncate text-[11px] text-ink-subtle">{target.name}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("promptMediaClose")}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line bg-surface text-ink-subtle hover:text-ink"
          >
            <i className="fas fa-times text-xs" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-stage-inset p-4">
          <Full target={target} />
        </div>

        <div className="flex shrink-0 gap-3 border-t border-line px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-2xl border border-line bg-black/[0.03] py-2.5 text-sm hover:bg-black/[0.06]"
          >
            {t("promptMediaClose")}
          </button>
          <button
            type="button"
            onClick={onInsert}
            className="flex flex-1 items-center justify-center gap-x-2 rounded-2xl bg-orange-700 py-2.5 text-sm font-semibold text-white hover:bg-orange-600"
          >
            <i className="fas fa-arrow-right" /> {t("promptMediaCite")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Thumb({ target }: { target: RefTarget }) {
  if (target.kind === "image") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={target.url} alt="" className="h-full w-full object-cover" />;
  }
  if (target.kind === "video") {
    return (
      <video
        src={`${target.url}#t=0.1`}
        className="h-full w-full object-cover"
        preload="metadata"
        muted
        playsInline
      />
    );
  }
  return (
    <span className="flex h-full w-full items-center justify-center text-ink-subtle">
      <i className="fas fa-music" />
    </span>
  );
}

function Full({ target }: { target: RefTarget }) {
  if (target.kind === "image") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={target.url} alt={target.name} className="max-h-[60vh] max-w-full object-contain" />;
  }
  if (target.kind === "video") {
    return <video src={target.url} controls playsInline className="max-h-[60vh] max-w-full" />;
  }
  return (
    <div className="flex w-full max-w-md flex-col items-center gap-3 py-6 text-ink-subtle">
      <i className="fas fa-music text-3xl" />
      <audio src={target.url} controls className="w-full" />
    </div>
  );
}
