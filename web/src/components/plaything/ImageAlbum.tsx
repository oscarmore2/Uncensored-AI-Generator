"use client";

import { useEffect, useState } from "react";
import type { PlaythingGen } from "./types";
import { MediaExpiryBadge } from "@/components/MediaExpiryBadge";

export function ImageAlbum({
  items,
  selectedId,
  onSelect,
}: {
  items: PlaythingGen[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const [lightbox, setLightbox] = useState<string[] | null>(null);
  const [lbIndex, setLbIndex] = useState(0);

  const succeeded = items.filter((g) => g.status === "succeeded" && g.result_urls?.length);
  const pending = items.filter((g) => g.status === "pending" || g.status === "processing");
  const failed = items.filter((g) => g.status === "failed");

  if (!items.length) {
    return <EmptyState title="还没有图片" hint="选择模型、填写提示词后点击生成" />;
  }

  return (
    <div className="space-y-4">
      {pending.length > 0 && (
        <div className="space-y-2">
          {pending.map((g) => (
            <StatusRow key={g.id} g={g} />
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {succeeded.map((g) => {
          const thumb = g.result_urls![0];
          const active = g.id === selectedId;
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => {
                onSelect(g.id);
                setLightbox(g.result_urls);
                setLbIndex(0);
              }}
              className={`relative aspect-square rounded-2xl overflow-hidden border bg-[#111] ${
                active ? "border-rose-500/60 ring-1 ring-rose-500/30" : "border-white/10 hover:border-white/25"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={thumb} alt="" className="w-full h-full object-cover" />
              <span className="absolute bottom-1 left-1 text-[10px] px-1.5 py-0.5 rounded bg-black/60 font-mono">
                #{g.id}
              </span>
              {g.is_adult && (
                <span className="absolute right-1 top-1 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold">18+</span>
              )}
              <span className="absolute bottom-1 right-1">
                <MediaExpiryBadge expiresAt={g.media_expires_at} deletedAt={g.media_deleted_at} compact />
              </span>
            </button>
          );
        })}
      </div>

      {failed.length > 0 && (
        <div className="space-y-1">
          {failed.slice(0, 5).map((g) => (
            <p key={g.id} className="text-xs text-red-400/80">
              #{g.id} 失败{g.error ? `：${g.error.slice(0, 80)}` : ""}
            </p>
          ))}
        </div>
      )}

      {lightbox && (
        <Lightbox
          urls={lightbox}
          index={lbIndex}
          onIndex={setLbIndex}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}

function StatusRow({ g }: { g: PlaythingGen }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-gray-400 flex justify-between gap-2">
      <span>
        #{g.id} · {g.product_label || g.model_id} · {g.status}
      </span>
      <span className="font-mono text-rose-300">{g.progress}%</span>
    </div>
  );
}

function Lightbox({
  urls,
  index,
  onIndex,
  onClose,
}: {
  urls: string[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") onIndex(Math.min(urls.length - 1, index + 1));
      if (e.key === "ArrowLeft") onIndex(Math.max(0, index - 1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, onClose, onIndex, urls.length]);

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/85 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="relative max-w-5xl w-full" onClick={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={urls[index]}
          alt=""
          className="max-h-[80vh] w-auto mx-auto rounded-2xl object-contain"
        />
        <div className="flex justify-center gap-3 mt-4">
          <button
            type="button"
            disabled={index <= 0}
            className="px-3 py-1.5 text-sm rounded-xl border border-white/20 disabled:opacity-40"
            onClick={() => onIndex(index - 1)}
          >
            上一张
          </button>
          <span className="text-sm text-gray-400 self-center">
            {index + 1} / {urls.length}
          </span>
          <button
            type="button"
            disabled={index >= urls.length - 1}
            className="px-3 py-1.5 text-sm rounded-xl border border-white/20 disabled:opacity-40"
            onClick={() => onIndex(index + 1)}
          >
            下一张
          </button>
          <button
            type="button"
            className="px-3 py-1.5 text-sm rounded-xl border border-white/20"
            onClick={onClose}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[280px] text-center px-6">
      <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center mb-4">
        <i className="fas fa-images text-gray-500 text-xl" />
      </div>
      <p className="text-gray-300 font-medium mb-1">{title}</p>
      <p className="text-xs text-gray-500 max-w-xs">{hint}</p>
    </div>
  );
}
