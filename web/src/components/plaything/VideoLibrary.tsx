"use client";

import { EmptyState } from "./ImageAlbum";
import type { PlaythingGen } from "./types";
import { MediaExpiryBadge } from "@/components/MediaExpiryBadge";

export function VideoLibrary({
  items,
  selectedId,
  onSelect,
}: {
  items: PlaythingGen[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const succeeded = items.filter((g) => g.status === "succeeded" && g.result_urls?.length);
  const selected = succeeded.find((g) => g.id === selectedId) ?? succeeded[0] ?? null;
  const activeUrl = selected?.result_urls?.[0] ?? null;

  if (!items.length) {
    return <EmptyState title="还没有视频" hint="选择视频模型并生成后，将在此播放与浏览" />;
  }

  return (
    <div className="flex flex-col lg:flex-row gap-4 min-h-[320px]">
      <div className="flex-1 rounded-2xl bg-black/40 border border-white/10 overflow-hidden flex items-center justify-center min-h-[220px]">
        {activeUrl ? (
          <div className="relative w-full">
            <video
              key={activeUrl}
              src={activeUrl}
              controls
              playsInline
              className="max-h-[min(60vh,560px)] w-full object-contain"
            />
            {selected?.is_adult && (
              <span className="absolute right-3 top-3 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold">18+</span>
            )}
            {selected && (
              <span className="absolute left-3 top-3">
                <MediaExpiryBadge expiresAt={selected.media_expires_at} deletedAt={selected.media_deleted_at} compact />
              </span>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-500 px-4 text-center">
            {items.some((g) => g.status === "processing" || g.status === "pending")
              ? "生成中，完成后可在此播放"
              : "选择左侧视频开始播放"}
          </p>
        )}
      </div>
      <div className="lg:w-48 shrink-0 space-y-2 max-h-[60vh] overflow-y-auto">
        {succeeded.map((g) => {
          const url = g.result_urls![0];
          const active = g.id === (selected?.id ?? null);
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => onSelect(g.id)}
              className={`w-full text-left rounded-xl border overflow-hidden ${
                active ? "border-rose-500/50" : "border-white/10 hover:border-white/25"
              }`}
            >
              <div className="aspect-video bg-[#111] relative">
                <video src={url} muted preload="metadata" className="w-full h-full object-cover" />
                <span className="absolute bottom-1 left-1 text-[10px] px-1 rounded bg-black/60 font-mono">
                  #{g.id}
                </span>
                {g.is_adult && (
                  <span className="absolute right-1 top-1 rounded-full bg-red-600 px-2 py-0.5 text-[9px] font-bold">18+</span>
                )}
              </div>
              <div className="px-2 py-1.5 text-[11px] text-gray-400 truncate">
                {g.product_label || g.model_id}
              </div>
            </button>
          );
        })}
        {items
          .filter((g) => g.status === "pending" || g.status === "processing")
          .map((g) => (
            <div
              key={g.id}
              className="rounded-xl border border-white/10 px-2 py-2 text-[11px] text-gray-500"
            >
              #{g.id} · {g.status} · {g.progress}%
            </div>
          ))}
      </div>
    </div>
  );
}
