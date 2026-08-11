"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, type ApiGeneration } from "@/lib/client";
import { AdaptiveMedia } from "@/components/WorkMedia";
import { MediaKindBadge, MediaThumb } from "@/components/MediaPreview";
import { MediaExpiryBadge } from "@/components/MediaExpiryBadge";
import { useApp } from "@/components/AppContext";
import { WorkReuseActions } from "@/components/WorkReuseActions";
import { downloadExtOf } from "@/lib/plaything-categories";
import { useLocale, useTranslations } from "next-intl";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";

export default function HistoryPage() {
  const t = useTranslations("History");
  const locale = useLocale();
  const { toast } = useApp();
  const [items, setItems] = useState<ApiGeneration[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ApiGeneration | null>(null);
  const [loaded, setLoaded] = useState(false);
  useBodyScrollLock(Boolean(selected));

  const load = useCallback(async () => {
    try {
      setItems(await api<ApiGeneration[]>("/api/generations"));
    } catch {
      toast(t("loadFailed"), true);
    } finally {
      setLoaded(true);
    }
  }, [t, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = search
    ? items.filter((i) => i.prompt.toLowerCase().includes(search.toLowerCase()))
    : items;

  return (
    <div>
      {/*
        原来标题与工具栏是一行，搜索框写死 w-64：手机上这一行要 485px，整页横向滚动。
        窄屏改成上下两段，搜索框吃满剩余宽度。
      */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-3xl font-bold tracking-tighter sm:text-4xl">{t("title")}</h1>
        <div className="flex min-w-0 gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("search")}
            className="w-full min-w-0 rounded-2xl border border-line bg-surface px-4 py-2 text-sm outline-none focus:border-orange-500/50 sm:w-64"
          />
          <button
            onClick={load}
            className="flex shrink-0 items-center gap-x-2 rounded-2xl border border-line bg-black/[0.03] px-4 py-2 text-sm hover:bg-black/[0.06]"
          >
            <i className="fas fa-sync-alt" /> <span className="hidden md:inline">{t("refresh")}</span>
          </button>
        </div>
      </div>

      {loaded && filtered.length === 0 ? (
        <div className="text-center py-16">
          <i className="fas fa-images text-6xl text-ink-subtle mb-4" />
          <p className="text-ink-muted">
            {t("empty")}
            <br />
            {t("emptyHint")}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filtered.map((item) => (
            <div
              key={item.id}
              onClick={() => setSelected(item)}
              className="result-card glass rounded-3xl overflow-hidden cursor-pointer"
            >
              <div className="relative aspect-[4/3] overflow-hidden bg-stage">
                {item.status === "succeeded" && item.result_urls?.length ? (
                  // 视频抽首帧、3D 用输入图或图标；早先一律用 <img> 导致视频/3D 裂图
                  <MediaThumb
                    urls={item.thumb_urls?.length ? item.thumb_urls : item.result_urls}
                    mode={item.mode}
                    alt={item.mode}
                    fallbackUrls={item.input_urls}
                  />
                ) : item.input_urls?.length && item.status !== "failed" ? (
                  <MediaThumb urls={null} mode={item.mode} fallbackUrls={item.input_urls} />
                ) : (
                  <div className="fake-image w-full h-full flex items-center justify-center">
                    <i
                      className={`fas ${item.status === "failed" ? "fa-triangle-exclamation text-red-700" : "fa-spinner fa-spin"} text-3xl`}
                    />
                  </div>
                )}
                {item.status === "succeeded" && (
                  <div className="absolute bottom-2 right-2">
                    <MediaKindBadge urls={item.result_urls} mode={item.mode} />
                  </div>
                )}
                <div className="absolute top-3 left-3">
                  <span className="text-[10px] px-2.5 py-px bg-black/60 rounded-full text-white">{item.mode}</span>
                  {item.is_adult && (
                    <span className="ml-1 rounded-full bg-red-700 px-2 py-px text-[10px] font-bold text-white">18+</span>
                  )}
                </div>
                <div className="absolute top-3 right-3 text-[10px] px-2 py-px bg-black/70 rounded-full text-white">
                  {item.cost}pt
                </div>
              </div>
              <div className="p-4">
                <MediaExpiryBadge
                  expiresAt={item.media_expires_at}
                  deletedAt={item.media_deleted_at}
                  compact
                />
                <div className="text-xs text-ink-muted mb-1">
                  {new Date(item.created_at).toLocaleDateString(locale)}
                </div>
                <div className="text-sm line-clamp-2">{item.prompt}</div>
                <div
                  className={`mt-3 text-xs ${item.status === "failed" ? "text-red-700" : "text-emerald-700"}`}
                >
                  {t.has(`statuses.${item.status}`) ? t(`statuses.${item.status}` as "statuses.pending") : item.status}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <div
          className="fixed inset-0 scrim z-[110] flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelected(null);
          }}
        >
          <div className="max-w-3xl w-full max-h-[90vh] flex flex-col glass rounded-3xl overflow-hidden modal-pop">
            <div className="shrink-0 p-5 flex justify-between border-b border-line">
              <div>
                <span className="font-semibold">{selected.mode}</span>
                {selected.is_adult && (
                  <span className="ml-2 rounded-full bg-red-700 px-2 py-0.5 text-[10px] font-bold text-white">18+</span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {/* 弹窗最高只有 90vh，3D 转起来实在看不清；给一个直达整页的出口 */}
                <Link
                  href={`/works/${selected.id}`}
                  aria-label={t("openFullPage")}
                  title={t("openFullPage")}
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-ink-muted hover:bg-black/[0.05] hover:text-ink"
                >
                  <i className="fas fa-up-right-and-down-left-from-center text-sm" />
                </Link>
                <button
                  onClick={() => setSelected(null)}
                  aria-label={t("close")}
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-2xl text-ink-muted hover:bg-black/[0.05] hover:text-ink"
                >
                  &times;
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 sm:p-4">
              {selected.status === "succeeded" && selected.result_urls?.length ? (
                <AdaptiveMedia mode={selected.mode} urls={selected.result_urls} />
              ) : (
                <div className="fake-image rounded-2xl h-80 flex items-center justify-center text-center">
                  <div>
                    {selected.media_deleted_at ? t("mediaDeleted") : t("processingOrFailed")}
                    <br />
                    <span className="text-xs">{selected.status}</span>
                  </div>
                </div>
              )}
              <div className="mt-6 text-sm bg-black/[0.04] p-4 rounded-2xl">{selected.prompt}</div>
              <div className="mt-3">
                <MediaExpiryBadge
                  expiresAt={selected.media_expires_at}
                  deletedAt={selected.media_deleted_at}
                />
              </div>
            </div>
            <div className="shrink-0 border-t border-line bg-surface p-4 space-y-3">
              <div className="flex gap-3">
                {selected.result_urls?.length ? (
                  <a
                    href={selected.result_urls[0]}
                    // 后缀按实际 URL 取：以前按 mode 猜，3D 会被存成 .jpg 下下来打不开
                    download={`wanwankewu_${selected.id}.${downloadExtOf(selected.result_urls[0])}`}
                    target="_blank"
                    rel="noopener"
                    className="flex-1 py-3 bg-orange-700 text-white font-semibold rounded-2xl flex items-center justify-center gap-x-2"
                  >
                    <i className="fas fa-download" /> {t("download")}
                  </a>
                ) : null}
                <button
                  onClick={() => setSelected(null)}
                  className="flex-1 py-3 bg-black/[0.03] border border-line rounded-2xl"
                >
                  {t("close")}
                </button>
              </div>
              <WorkReuseActions
                generationId={selected.id}
                onNavigate={() => setSelected(null)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
