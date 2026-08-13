"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { WorkMedia } from "./WorkMedia";
import { MediaExpiryBadge } from "./MediaExpiryBadge";
import { buildWorkGallery } from "@/lib/plaything-categories";
import { downloadHref, downloadMany, downloadOne, type DownloadSource } from "@/lib/media-download";

/**
 * 作品详情的统一外壳：左边深浅统一的画布，右边信息栏。
 * /history 弹窗、/works/[id]、/plaything、/explore 共用这一套外观。
 *
 * 画廊规则见 buildWorkGallery：只有图片可以是多件，视频/3D/音频固定单件。
 * 因此这里任何时候只挂载一个 video / model-viewer 实例——切换即卸载，
 * 不会出现两份解码缓冲或两个 WebGL 上下文同时压着。
 */
export function WorkDetail({
  source,
  mode,
  urls,
  title,
  timestamp,
  prompt,
  negativePrompt,
  params,
  spicy = false,
  adult = false,
  cost,
  expiresAt,
  deletedAt,
  onClose,
  fullPageHref,
  actions,
  emptyHint,
  layout = "dialog",
}: {
  source: DownloadSource;
  mode: string;
  urls: string[];
  title?: string | null;
  timestamp?: string | null;
  prompt?: string | null;
  negativePrompt?: string | null;
  params?: Record<string, unknown>;
  spicy?: boolean;
  adult?: boolean;
  cost?: number | null;
  expiresAt?: string | null;
  deletedAt?: string | null;
  onClose?: () => void;
  fullPageHref?: string;
  /** 调用方自己的操作区（套用参数、重新生成、复制到生成器……） */
  actions?: ReactNode;
  /** 没有结果时显示的文案 */
  emptyHint?: ReactNode;
  /** dialog 走弹窗高度限制；page 铺在整页里，不设上限 */
  layout?: "dialog" | "page";
}) {
  const t = useTranslations("WorkDetail");
  const [index, setIndex] = useState(0);
  const [copied, setCopied] = useState(false);

  const gallery = useMemo(() => buildWorkGallery(urls, mode), [urls, mode]);
  const total = gallery.items.length;
  const current = gallery.items[Math.min(index, Math.max(total - 1, 0))] ?? null;

  const go = useCallback(
    (next: number) => setIndex(Math.max(0, Math.min(next, total - 1))),
    [total]
  );

  // 只有多件时才接管左右键，免得单件作品里按方向键什么都没发生却拦了页面滚动
  useEffect(() => {
    if (!gallery.multi) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") go(index - 1);
      else if (e.key === "ArrowRight") go(index + 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [gallery.multi, go, index]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copyLink() {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(current.url);
      setCopied(true);
    } catch {
      // 剪贴板被浏览器策略挡住时静默——没有 toast 通道，硬报错反而更吵
    }
  }

  async function share() {
    if (!current) return;
    const url = current.url;
    // navigator.share 只在安全上下文 + 支持的平台上有；没有就退回复制
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: title ?? t("shareTitle"), url });
        return;
      } catch {
        // 用户取消分享也会抛，这里不做区分，直接落到复制
      }
    }
    await copyLink();
  }

  const paramEntries = useMemo(() => {
    if (!params) return [] as [string, unknown][];
    // base64 参考图有几 MB，摊在参数表里既没意义又会把面板撑爆
    return Object.entries(params).filter(
      ([k, v]) => k !== "image_base64" && !(typeof v === "string" && v.startsWith("data:"))
    );
  }, [params]);

  const stageHeight = layout === "dialog" ? "max-h-[min(56vh,520px)]" : "max-h-[min(70vh,720px)]";

  return (
    <div
      className={`flex w-full flex-col overflow-hidden rounded-3xl border border-line bg-surface ${
        layout === "dialog"
          ? "max-h-[92vh] overflow-y-auto overscroll-contain lg:grid lg:grid-cols-[minmax(0,1.45fr)_minmax(330px,0.78fr)] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden"
          : "lg:grid lg:grid-cols-[minmax(0,1.45fr)_minmax(330px,0.78fr)]"
      }`}
    >
      {/*
        窄屏时画布不许被压缩：min-h-0 会让它塌到比内容还矮，
        里面的视频仍是自己的高度，于是直接盖住下面的标题和按钮。
      */}
      <section className="flex shrink-0 flex-col bg-stage lg:min-h-0 lg:shrink">
        <div className="relative flex min-h-0 flex-1 items-center justify-center p-3 sm:p-5">
          {current ? (
            <>
              {gallery.multi && (
                <span className="absolute left-3 top-3 z-10 rounded-full border border-line bg-surface px-2.5 py-0.5 font-mono text-[11px] tabular-nums text-ink-muted">
                  {index + 1} / {total}
                </span>
              )}

              <div className="absolute right-3 top-3 z-10 flex flex-col gap-1.5">
                <a
                  href={downloadHref(source, gallery.files.find((f) => f.galleryIndex === index)?.galleryIndex ?? index)}
                  download
                  title={t("downloadThis")}
                  aria-label={t("downloadThis")}
                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-surface text-ink-muted shadow-sm hover:border-line-strong hover:text-ink"
                >
                  <i className="fas fa-download text-xs" />
                </a>
                <button
                  type="button"
                  onClick={share}
                  title={t("share")}
                  aria-label={t("share")}
                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-surface text-ink-muted shadow-sm hover:border-line-strong hover:text-ink"
                >
                  <i className="fas fa-share-nodes text-xs" />
                </button>
                <button
                  type="button"
                  onClick={copyLink}
                  title={copied ? t("copied") : t("copyLink")}
                  aria-label={t("copyLink")}
                  className={`flex h-9 w-9 items-center justify-center rounded-xl border bg-surface shadow-sm ${
                    copied
                      ? "border-orange-500 text-orange-700"
                      : "border-line text-ink-muted hover:border-line-strong hover:text-ink"
                  }`}
                >
                  <i className={`fas ${copied ? "fa-check" : "fa-link"} text-xs`} />
                </button>
              </div>

              {gallery.multi && (
                <>
                  <button
                    type="button"
                    onClick={() => go(index - 1)}
                    disabled={index === 0}
                    aria-label={t("prev")}
                    className="absolute left-2 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-surface text-ink shadow-sm hover:border-orange-500 hover:text-orange-700 disabled:opacity-35 disabled:shadow-none disabled:hover:border-line disabled:hover:text-ink"
                  >
                    <i className="fas fa-chevron-left text-sm" />
                  </button>
                  <button
                    type="button"
                    onClick={() => go(index + 1)}
                    disabled={index >= total - 1}
                    aria-label={t("next")}
                    className="absolute right-2 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-surface text-ink shadow-sm hover:border-orange-500 hover:text-orange-700 disabled:opacity-35 disabled:shadow-none disabled:hover:border-line disabled:hover:text-ink"
                  >
                    <i className="fas fa-chevron-right text-sm" />
                  </button>
                </>
              )}

              <WorkMedia
                key={current.url}
                mode={mode}
                src={current.url}
                poster={current.poster}
                controls
                autoPlay
                muted
                loop
                alt={title ?? mode}
                className={`w-auto ${stageHeight} max-w-full rounded-2xl object-contain`}
              />
            </>
          ) : (
            <div className="fake-image flex min-h-[220px] w-full items-center justify-center rounded-2xl p-6 text-center text-sm text-ink-muted">
              {emptyHint ?? t("noMedia")}
            </div>
          )}
        </div>

        {gallery.multi && (
          <div
            className="flex gap-2 overflow-x-auto border-t border-line bg-stage-inset px-3 py-2.5"
            role="tablist"
            aria-label={t("galleryAria")}
          >
            {gallery.items.map((item, i) => (
              <button
                key={item.url}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={t("itemAria", { number: i + 1 })}
                onClick={() => go(i)}
                className={`h-14 w-14 shrink-0 overflow-hidden rounded-xl border-2 bg-surface transition ${
                  i === index
                    ? "border-orange-500 ring-[3px] ring-orange-500/15"
                    : "border-line saturate-50 hover:border-line-strong hover:saturate-100"
                }`}
              >
                <WorkMedia
                  mode={mode}
                  src={item.poster ?? item.url}
                  asThumbnail
                  className="h-full w-full object-cover"
                  alt=""
                />
              </button>
            ))}
          </div>
        )}
      </section>

      <aside
        className={`flex min-w-0 flex-col gap-4 border-t border-line p-5 lg:border-l lg:border-t-0 ${
          layout === "dialog" ? "lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain" : ""
        }`}
      >
        <div>
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="media-badge">{mode}</span>
              {spicy && (
                <span className="rounded-full bg-fuchsia-700 px-2 py-0.5 text-[10px] font-bold text-white">
                  SPICY
                </span>
              )}
              {adult && (
                <span className="rounded-full bg-red-700 px-2 py-0.5 text-[10px] font-bold text-white">
                  18+
                </span>
              )}
              {typeof cost === "number" && (
                <span className="rounded-full border border-line-strong px-2 py-0.5 text-[10px] font-semibold tabular-nums text-ink-muted">
                  {cost} pt
                </span>
              )}
            </div>
            {(fullPageHref || onClose) && (
              <div className="flex shrink-0 items-center gap-1">
                {fullPageHref && (
                  <Link
                    href={fullPageHref}
                    aria-label={t("openFullPage")}
                    title={t("openFullPage")}
                    className="flex h-9 w-9 items-center justify-center rounded-xl text-ink-muted hover:bg-black/[0.05] hover:text-ink"
                  >
                    <i className="fas fa-up-right-and-down-left-from-center text-sm" />
                  </Link>
                )}
                {onClose && (
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label={t("close")}
                    className="flex h-9 w-9 items-center justify-center rounded-xl text-2xl leading-none text-ink-muted hover:bg-black/[0.05] hover:text-ink"
                  >
                    &times;
                  </button>
                )}
              </div>
            )}
          </div>
          {title && <h2 className="mt-3 text-xl font-bold tracking-tight">{title}</h2>}
          {timestamp && <div className="mt-1 text-xs tabular-nums text-ink-subtle">{timestamp}</div>}
        </div>

        {(expiresAt || deletedAt) && (
          <MediaExpiryBadge expiresAt={expiresAt ?? null} deletedAt={deletedAt ?? null} />
        )}

        {total > 0 && (
          <div className="grid gap-2">
            <button
              type="button"
              onClick={() => void downloadMany(source, gallery.files.length)}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-orange-700 py-3 font-bold text-white hover:bg-orange-800"
            >
              <i className="fas fa-download" />
              {gallery.files.length > 1
                ? t("downloadAll", { count: gallery.files.length })
                : t("download")}
            </button>
            {actions}
          </div>
        )}

        {prompt?.trim() && (
          <div>
            <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-ink-subtle">
              {t("prompt")}
            </div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{prompt}</p>
          </div>
        )}

        {negativePrompt?.trim() && (
          <div>
            <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-ink-subtle">
              {t("negativePrompt")}
            </div>
            <p className="text-sm leading-relaxed text-ink-muted">{negativePrompt}</p>
          </div>
        )}

        {/*
          文件清单和画布联动：点一行切过去，正在看的那一行高亮。
          3D 的贴图包、视频的封面这类不进画廊的附属件也列在这里，
          否则用户会以为只生成了一个文件。
        */}
        {gallery.files.length > 0 && (
          <div>
            <div className="mb-2 flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-widest text-ink-subtle">
              <span>{t("files")}</span>
              <span className="tabular-nums text-orange-700">
                {t("fileCount", { count: gallery.files.length })}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              {gallery.files.map((f, i) => {
                const active = f.galleryIndex !== null && f.galleryIndex === index;
                const clickable = f.galleryIndex !== null;
                return (
                  <div
                    key={`${f.url}-${i}`}
                    className={`flex items-center gap-2.5 rounded-xl border px-2.5 py-2 ${
                      active ? "border-orange-500 bg-orange-500/10" : "border-line bg-surface"
                    }`}
                  >
                    <button
                      type="button"
                      disabled={!clickable}
                      onClick={() => clickable && go(f.galleryIndex as number)}
                      className={`flex min-w-0 flex-1 items-center gap-2.5 text-left ${
                        clickable ? "cursor-pointer" : "cursor-default"
                      }`}
                    >
                      <span className="shrink-0 rounded-md bg-orange-500/15 px-1.5 py-1 text-center font-mono text-[10px] font-bold text-orange-700">
                        .{f.ext}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-muted">
                        {f.url.split("/").pop()?.split(/[?#]/)[0] ?? f.url}
                      </span>
                    </button>
                    <a
                      href={downloadHref(source, i)}
                      download
                      onClick={(e) => e.stopPropagation()}
                      aria-label={t("downloadThis")}
                      title={t("downloadThis")}
                      className="shrink-0 text-ink-subtle hover:text-orange-700"
                    >
                      <i className="fas fa-download text-xs" />
                    </a>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {paramEntries.length > 0 && (
          <div>
            <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-ink-subtle">
              {t("parameters")}
            </div>
            <div className="divide-y divide-line rounded-2xl border border-line px-3">
              {paramEntries.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 py-2 text-xs">
                  <span className="font-mono text-ink-subtle">{k}</span>
                  <span className="max-w-[62%] break-all text-right font-mono tabular-nums text-ink-muted">
                    {typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

/** 供调用方复用的单件下载，省得各自去拼代理 URL */
export { downloadOne };
