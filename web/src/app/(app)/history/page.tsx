"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type ApiGeneration } from "@/lib/client";
import { useApp } from "@/components/AppContext";
import { AdaptiveMedia } from "@/components/WorkMedia";
import { MediaExpiryBadge } from "@/components/MediaExpiryBadge";

export default function HistoryPage() {
  const { toast } = useApp();
  const [items, setItems] = useState<ApiGeneration[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ApiGeneration | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await api<ApiGeneration[]>("/api/generations"));
    } catch {
      toast("加载历史失败", true);
    } finally {
      setLoaded(true);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = search
    ? items.filter((i) => i.prompt.toLowerCase().includes(search.toLowerCase()))
    : items;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-4xl font-bold tracking-tighter">我的作品</h1>
        <div className="flex gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索提示词..."
            className="bg-[#111] border border-white/10 px-4 py-2 rounded-2xl text-sm w-64 focus:border-rose-500/50 outline-none"
          />
          <button
            onClick={load}
            className="px-4 py-2 text-sm bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl flex items-center gap-x-2"
          >
            <i className="fas fa-sync-alt" /> <span className="hidden md:inline">刷新</span>
          </button>
        </div>
      </div>

      {loaded && filtered.length === 0 ? (
        <div className="text-center py-16">
          <i className="fas fa-images text-6xl text-gray-700 mb-4" />
          <p className="text-gray-400">
            还没有生成记录
            <br />
            快去创作中心试试吧！
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
              <div className="relative">
                {item.status === "succeeded" && item.result_urls?.length ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.result_urls[0]} className="w-full aspect-[4/3] object-cover" alt={item.mode} />
                ) : (
                  <div className="fake-image aspect-[16/9] flex items-center justify-center">
                    <i
                      className={`fas ${item.status === "failed" ? "fa-triangle-exclamation text-red-400" : "fa-spinner fa-spin"} text-3xl`}
                    />
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
                  {new Date(item.created_at).toLocaleDateString()}
                </div>
                <div className="text-sm line-clamp-2">{item.prompt}</div>
                <div
                  className={`mt-3 text-xs ${item.status === "failed" ? "text-red-400" : "text-emerald-400"}`}
                >
                  {item.status}
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
                    {selected.media_deleted_at ? "媒体已按保留策略清理" : "生成中或失败"}
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
                    <i className="fas fa-download" /> 下载
                  </a>
                ) : null}
                <button
                  onClick={() => setSelected(null)}
                  className="flex-1 py-3 bg-white/5 border border-white/10 rounded-2xl"
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
