"use client";

import { EmptyState } from "./ImageAlbum";
import type { PlaythingGen } from "./types";
import { MediaExpiryBadge } from "@/components/MediaExpiryBadge";
import { buildWorkGallery } from "@/lib/plaything-categories";
import { useTranslations } from "next-intl";

/**
 * 取这条结果里真正的视频。
 * 不能直接用 result_urls[0]：上游常常同时给 [封面.jpg, 片子.mp4]，顺序还不保证，
 * 撞上封面在前就会把一张图喂给 <video>，播放器直接空着。
 */
function videoOf(g: { result_urls: string[] | null; media_kind: string }) {
  const gallery = buildWorkGallery(g.result_urls, undefined, "video");
  return gallery.items[0] ?? null;
}

export function VideoLibrary({
  items,
  selectedId,
  onSelect,
}: {
  items: PlaythingGen[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const t = useTranslations("Plaything");
  const succeeded = items.filter((g) => g.status === "succeeded" && g.result_urls?.length);
  const selected = succeeded.find((g) => g.id === selectedId) ?? succeeded[0] ?? null;
  const active = selected ? videoOf(selected) : null;
  const activeUrl = active?.url ?? null;

  if (!items.length) {
    return <EmptyState title={t("noVideos")} hint={t("videoHint")} />;
  }

  return (
    <div className="flex flex-col lg:flex-row gap-4 min-h-[320px]">
      <div className="flex-1 rounded-2xl bg-stage border border-line overflow-hidden flex items-center justify-center min-h-[220px]">
        {activeUrl ? (
          <div className="relative w-full">
            <video
              key={activeUrl}
              src={activeUrl}
              poster={active?.poster ?? undefined}
              controls
              playsInline
              className="max-h-[min(60vh,560px)] w-full object-contain"
            />
            {selected?.is_adult && (
              <span className="absolute right-3 top-3 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold text-white">18+</span>
            )}
            {selected && (
              <span className="absolute left-3 top-3">
                <MediaExpiryBadge expiresAt={selected.media_expires_at} deletedAt={selected.media_deleted_at} compact />
              </span>
            )}
          </div>
        ) : (
          <p className="text-sm text-ink-subtle px-4 text-center">
            {items.some((g) => g.status === "processing" || g.status === "pending")
              ? t("videoProcessing")
              : t("selectVideo")}
          </p>
        )}
      </div>
      <div className="lg:w-48 shrink-0 space-y-2 max-h-[60vh] overflow-y-auto overscroll-contain">
        {succeeded.map((g) => {
          const thumb = videoOf(g);
          const url = thumb?.url ?? "";
          const isActive = g.id === (selected?.id ?? null);
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => onSelect(g.id)}
              className={`w-full text-left rounded-xl border overflow-hidden ${
                isActive ? "border-orange-500/50" : "border-line hover:border-line-strong"
              }`}
            >
              <div className="aspect-video bg-stage relative">
                <video
                  src={url}
                  poster={thumb?.poster ?? undefined}
                  muted
                  preload="metadata"
                  className="w-full h-full object-cover"
                />
                <span className="absolute bottom-1 left-1 text-[10px] px-1 rounded bg-black/60 font-mono text-white">
                  #{g.id}
                </span>
                {g.is_adult && (
                  <span className="absolute right-1 top-1 rounded-full bg-red-600 px-2 py-0.5 text-[9px] font-bold text-white">18+</span>
                )}
              </div>
              <div className="px-2 py-1.5 text-[11px] text-ink-muted truncate">
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
              className="rounded-xl border border-line px-2 py-2 text-[11px] text-ink-subtle"
            >
              #{g.id} · {g.status} · {g.progress}%
            </div>
          ))}
      </div>
    </div>
  );
}
