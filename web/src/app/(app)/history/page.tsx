"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type ApiGeneration } from "@/lib/client";
import { useApp } from "@/components/AppContext";
import { AdaptiveMedia } from "@/components/WorkMedia";
import { MediaKindBadge, MediaThumb } from "@/components/MediaPreview";
import {
  InputMediaGoneDialog,
  type ReuseMediaItem,
} from "@/components/InputMediaGoneDialog";
import { MediaExpiryBadge } from "@/components/MediaExpiryBadge";
import { useLocale, useTranslations } from "next-intl";

export default function HistoryPage() {
  const t = useTranslations("History");
  const locale = useLocale();
  const { toast } = useApp();
  const [items, setItems] = useState<ApiGeneration[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ApiGeneration | null>(null);
  const [loaded, setLoaded] = useState(false);
  const router = useRouter();
  /** 输入图已被清理时先弹说明框，用户确认后才继续跳转（只填参数不填图） */
  const [gone, setGone] = useState<{
    items: ReuseMediaItem[];
    unrecorded: boolean;
    go: (skipMedia: boolean) => void;
  } | null>(null);
  const [checking, setChecking] = useState(false);

  /**
   * 套用 / 重新生成：先问一遍当初的参考图还在不在。
   * 还在就直接带过去，不在就先把「哪个文件、何时传、何时删、为何删」讲清楚，
   * 用户确认后只恢复参数，媒体留给他自己重新上传。
   */
  const openInMake = useCallback(
    async (item: ApiGeneration, run: boolean) => {
      if (checking) return;
      setChecking(true);
      const go = (skipMedia: boolean) => {
        const q = new URLSearchParams({ reuse: String(item.id) });
        if (run) q.set("run", "1");
        if (skipMedia) q.set("nomedia", "1");
        router.push(`/make?${q.toString()}`);
      };
      try {
        const info = await api<{
          needs_image: boolean;
          input_unrecorded: boolean;
          media: { all_available: boolean; items: ReuseMediaItem[] };
        }>(`/api/generations/${item.id}/reuse`);

        const missing = info.needs_image && (!info.media.all_available || info.input_unrecorded);
        if (missing) {
          setGone({
            items: info.media.items,
            unrecorded: info.input_unrecorded,
            go,
          });
          return;
        }
        go(false);
      } catch {
        toast(t("reuseFailed"), true);
      } finally {
        setChecking(false);
      }
    },
    [checking, router, t, toast]
  );

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
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-4xl font-bold tracking-tighter">{t("title")}</h1>
        <div className="flex gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("search")}
            className="bg-[#111] border border-white/10 px-4 py-2 rounded-2xl text-sm w-64 focus:border-orange-500/50 outline-none"
          />
          <button
            onClick={load}
            className="px-4 py-2 text-sm bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl flex items-center gap-x-2"
          >
            <i className="fas fa-sync-alt" /> <span className="hidden md:inline">{t("refresh")}</span>
          </button>
        </div>
      </div>

      {loaded && filtered.length === 0 ? (
        <div className="text-center py-16">
          <i className="fas fa-images text-6xl text-gray-700 mb-4" />
          <p className="text-gray-400">
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
              <div className="relative aspect-[4/3] overflow-hidden">
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
                      className={`fas ${item.status === "failed" ? "fa-triangle-exclamation text-red-400" : "fa-spinner fa-spin"} text-3xl`}
                    />
                  </div>
                )}
                {item.status === "succeeded" && (
                  <div className="absolute bottom-2 right-2">
                    <MediaKindBadge urls={item.result_urls} mode={item.mode} />
                  </div>
                )}
                <div className="absolute top-3 left-3">
                  <span className="text-[10px] px-2.5 py-px bg-black/60 rounded-full">{item.mode}</span>
                  {item.is_adult && (
                    <span className="ml-1 rounded-full bg-red-600 px-2 py-px text-[10px] font-bold text-white">18+</span>
                  )}
                </div>
                <div className="absolute top-3 right-3 text-[10px] px-2 py-px bg-black/70 rounded-full">
                  {item.cost}pt
                </div>
              </div>
              <div className="p-4">
                <MediaExpiryBadge
                  expiresAt={item.media_expires_at}
                  deletedAt={item.media_deleted_at}
                  compact
                />
                <div className="text-xs text-gray-400 mb-1">
                  {new Date(item.created_at).toLocaleDateString(locale)}
                </div>
                <div className="text-sm line-clamp-2">{item.prompt}</div>
                <div
                  className={`mt-3 text-xs ${item.status === "failed" ? "text-red-400" : "text-emerald-400"}`}
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
          className="fixed inset-0 bg-black/95 z-[110] flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelected(null);
          }}
        >
          <div className="max-w-3xl w-full glass rounded-3xl overflow-hidden modal-pop">
            <div className="p-5 flex justify-between border-b border-white/10">
              <div>
                <span className="font-semibold">{selected.mode}</span>
                {selected.is_adult && (
                  <span className="ml-2 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold text-white">18+</span>
                )}
              </div>
              <button onClick={() => setSelected(null)} className="text-3xl text-gray-400 hover:text-white">
                &times;
              </button>
            </div>
            <div className="p-2 sm:p-4">
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
              <div className="mt-6 text-sm bg-black/40 p-4 rounded-2xl">{selected.prompt}</div>
              <div className="mt-3">
                <MediaExpiryBadge
                  expiresAt={selected.media_expires_at}
                  deletedAt={selected.media_deleted_at}
                />
              </div>
              <div className="flex gap-3 mt-6 px-4 pb-4">
                {selected.result_urls?.length ? (
                  <a
                    href={selected.result_urls[0]}
                    download={`wanwankewu_${selected.id}${selected.mode.endsWith("vid") ? ".mp4" : ".jpg"}`}
                    target="_blank"
                    rel="noopener"
                    className="flex-1 py-3 bg-white text-black font-semibold rounded-2xl flex items-center justify-center gap-x-2"
                  >
                    <i className="fas fa-download" /> {t("download")}
                  </a>
                ) : null}
                <button
                  onClick={() => setSelected(null)}
                  className="flex-1 py-3 bg-white/5 border border-white/10 rounded-2xl"
                >
                  {t("close")}
                </button>
              </div>
              <div className="flex gap-3 px-4 pb-6">
                <button
                  onClick={() => void openInMake(selected, false)}
                  disabled={checking}
                  className="flex-1 py-3 bg-white/5 border border-white/10 rounded-2xl flex items-center justify-center gap-x-2 disabled:opacity-40"
                >
                  <i className="fas fa-rotate-left" /> {t("reuse")}
                </button>
                <button
                  onClick={() => void openInMake(selected, true)}
                  disabled={checking}
                  className="flex-1 py-3 bg-orange-600 hover:bg-orange-500 rounded-2xl font-semibold flex items-center justify-center gap-x-2 disabled:opacity-40"
                >
                  <i className="fas fa-rotate-right" /> {t("retry")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {gone && (
        <InputMediaGoneDialog
          items={gone.items}
          unrecorded={gone.unrecorded}
          onCancel={() => setGone(null)}
          onConfirm={() => {
            const go = gone.go;
            setGone(null);
            go(true);
          }}
        />
      )}
    </div>
  );
}
