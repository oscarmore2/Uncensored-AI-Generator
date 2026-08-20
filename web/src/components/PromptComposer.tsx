"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  PromptMentionBox,
  type MentionTarget,
  type PromptMentionHandle,
} from "./PromptMentionBox";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { renderMiniMarkdown } from "@/lib/mini-markdown";

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

const KIND_ICON: Record<MentionTarget["kind"], string> = {
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
}: {
  value: string;
  onChange: (next: string) => void;
  targets: MentionTarget[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const t = useTranslations("Make");
  const [expanded, setExpanded] = useState(false);
  const [preview, setPreview] = useState<MentionTarget | null>(null);
  /* 预览只是**排版辅助**：上行的始终是原始文本，与编辑器逐字节一致 */
  const [previewing, setPreviewing] = useState(false);

  const inlineHandle = useRef<PromptMentionHandle | null>(null);
  const modalHandle = useRef<PromptMentionHandle | null>(null);

  useBodyScrollLock(expanded);

  const labels = {
    header: t("mentionHeader"),
    navigate: t("mentionNavigate"),
    select: t("mentionSelect"),
    close: t("mentionClose"),
    empty: t("mentionNoMatch"),
  };

  const kindLabel: Record<MentionTarget["kind"], string> = {
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

  /* 引用落到当前可见的那个输入框上：弹窗开着就是弹窗里那个 */
  const insert = useCallback(
    (target: MentionTarget) => {
      const h = expanded ? modalHandle.current : inlineHandle.current;
      h?.insertToken(target.token);
    },
    [expanded]
  );

  /*
   * Esc 的处理顺序：素材大图 → 弹窗。
   * defaultPrevented 是关键：@ 菜单开着时 PromptMentionBox 自己会先吃掉 Esc
   * 并 preventDefault，这里就不能再把整个弹窗关掉——否则用户按一下 Esc
   * 想收起菜单，结果整段编辑区都消失了。
   */
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (preview) setPreview(null);
      else setExpanded(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [expanded, preview]);

  const citeMedia = useCallback(
    (target: MentionTarget) => {
      /* 窄屏预览态下编辑器是藏起来的，没有光标可插，先切回编辑 */
      setPreviewing((on) => (window.innerWidth < 1024 ? false : on));
      requestAnimationFrame(() => insert(target));
    },
    [insert]
  );

  return (
    <>
      <div className="relative">
        <PromptMentionBox
          value={value}
          onChange={onChange}
          targets={targets}
          handle={inlineHandle}
          className={className}
          placeholder={placeholder}
          disabled={disabled}
          labels={labels}
        />
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
              if (e.target === e.currentTarget) setExpanded(false);
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
                {previewing ? t("promptEditMode") : t("promptPreview")}
              </button>
              <button
                type="button"
                onClick={() => setExpanded(false)}
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
                  <PromptMentionBox
                    value={value}
                    onChange={onChange}
                    targets={targets}
                    handle={modalHandle}
                    placeholder={placeholder}
                    disabled={disabled}
                    labels={labels}
                    wrapperClassName="flex min-h-0 flex-1 flex-col"
                    /* 不带 prompt-box：那条类是给常态输入框的，它的 min-height:120px
                     * 与这里的撑满冲突，而且同 specificity 下它靠源序赢 */
                    className="h-[46vh] w-full resize-none overscroll-contain rounded-2xl border border-line bg-surface p-4 text-sm outline-none placeholder:text-ink-subtle focus:border-orange-500/60 md:landscape:h-auto md:landscape:flex-1"
                  />
                </div>

                {previewing && (
                  <div className="flex min-h-0 flex-col md:landscape:flex-1">
                    <div
                      className="prompt-preview h-[46vh] overflow-y-auto overscroll-contain rounded-2xl border border-line bg-surface p-4 text-sm md:landscape:h-auto md:landscape:min-h-0 md:landscape:flex-1"
                      /* 内容已在 renderMiniMarkdown 里先转义后变换，插入的标签
                       * 只可能是那里写死的几个 */
                      dangerouslySetInnerHTML={{ __html: renderMiniMarkdown(value) }}
                    />
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
  target: MentionTarget;
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
  target: MentionTarget;
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

function Thumb({ target }: { target: MentionTarget }) {
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

function Full({ target }: { target: MentionTarget }) {
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
