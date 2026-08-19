"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  PromptMentionBox,
  type MentionTarget,
  type PromptMentionHandle,
} from "./PromptMentionBox";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";

/**
 * 提示词输入区：常态是一个输入框，点放大进全屏弹窗。
 *
 * 弹窗里多出一条素材轨。参考生视频这类模式常常要在一长段描述里反复点名
 * 「这句说的是哪一份素材」，而素材缩略图在页面下方——写着写着就得往下翻，
 * 数第几张，翻回来接着写。把素材摆在编辑区旁边，一点就插进光标处。
 *
 * 桌面端悬停素材出两个按钮：眼睛看大图、箭头直接引用。
 * 触屏没有 hover，所以两个按钮常显。
 */
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
          className="fixed inset-0 z-40 flex flex-col bg-black/45 p-0 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label={t("promptExpand")}
          onMouseDown={(e) => {
            // 只有点在背板上才关；点内部拖选到框外松手不该把弹窗关掉
            if (e.target === e.currentTarget) setExpanded(false);
          }}
        >
          <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col overflow-hidden rounded-none border-line bg-stage shadow-2xl sm:rounded-3xl sm:border">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <div className="text-sm font-semibold">{t("promptExpandTitle")}</div>
                <div className="truncate text-[11px] text-ink-subtle">
                  {targets.length ? t("mentionHint") : t("mentionUploadFirst")}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                aria-label={t("promptCollapse")}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line bg-surface text-ink-subtle hover:text-ink"
              >
                <i className="fas fa-compress text-xs" />
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col p-4 sm:p-5">
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
                className="w-full flex-1 resize-none rounded-2xl border border-line bg-surface p-4 text-sm outline-none placeholder:text-ink-subtle focus:border-orange-500/60"
              />
            </div>

            {targets.length > 0 && (
              <div className="shrink-0 border-t border-line bg-surface/60 px-4 py-3 sm:px-5">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">
                  {t("mentionHeader")}
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {targets.map((target) => (
                    <MediaTile
                      key={`${target.token}-${target.url}`}
                      target={target}
                      onPreview={() => setPreview(target)}
                      onInsert={() => insert(target)}
                      previewLabel={t("promptMediaPreview")}
                      insertLabel={t("promptMediaCite")}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {preview && (
        <MediaPreviewDialog
          target={preview}
          onClose={() => setPreview(null)}
          onInsert={() => {
            insert(preview);
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
    <div className="group relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl border border-line bg-stage">
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
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
