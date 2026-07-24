"use client";

import { useEffect, useMemo } from "react";
import { EmptyState } from "./ImageAlbum";
import { detectMediaKindFromUrl } from "@/lib/plaything-categories";
import type { PlaythingGen } from "./types";
import { MediaExpiryBadge } from "@/components/MediaExpiryBadge";

export function Model3DViewer({
  items,
  selectedId,
  onSelect,
}: {
  items: PlaythingGen[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  useEffect(() => {
    void import("@google/model-viewer");
  }, []);

  const succeeded = items.filter((g) => g.status === "succeeded" && g.result_urls?.length);
  const selected = succeeded.find((g) => g.id === selectedId) ?? succeeded[0] ?? null;

  const modelUrl = useMemo(() => {
    if (!selected?.result_urls?.length) return null;
    const hit = selected.result_urls.find((u) => detectMediaKindFromUrl(u, "3d") === "3d");
    return hit ?? selected.result_urls.find((u) => /\.(glb|gltf)(\?|#|$)/i.test(u)) ?? null;
  }, [selected]);

  if (!items.length) {
    return <EmptyState title="还没有 3D 资产" hint="选择 3D 模型并生成后，可在此旋转查看" />;
  }

  return (
    <div className="flex flex-col lg:flex-row gap-4 min-h-[320px]">
      <div className="flex-1 rounded-2xl border border-white/10 bg-[#0c0c0c] overflow-hidden min-h-[280px]">
        {modelUrl ? (
          <model-viewer
            src={modelUrl}
            alt="3D 生成结果"
            camera-controls
            touch-action="pan-y"
            auto-rotate
            style={{ width: "100%", height: "min(60vh, 520px)", background: "#0c0c0c" }}
          />
        ) : selected?.result_urls?.length ? (
          <div className="p-6 text-sm text-gray-400 space-y-3">
            <p>当前结果不是可预览的 glb/gltf，可下载查看：</p>
            <ul className="space-y-2">
              {selected.result_urls.map((u) => (
                <li key={u}>
                  <a
                    href={u}
                    target="_blank"
                    rel="noreferrer"
                    className="text-rose-400 hover:underline break-all"
                  >
                    {u}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-gray-500">
            选择一条 3D 结果开始预览
          </div>
        )}
      </div>
      <div className="lg:w-44 shrink-0 space-y-2 max-h-[60vh] overflow-y-auto">
        {selected && (
          <div className="pb-1">
            <MediaExpiryBadge
              expiresAt={selected.media_expires_at}
              deletedAt={selected.media_deleted_at}
              compact
            />
          </div>
        )}
        {succeeded.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => onSelect(g.id)}
            className={`w-full text-left rounded-xl px-3 py-2 text-xs border ${
              g.id === selected?.id
                ? "border-rose-500/40 bg-rose-500/10"
                : "border-white/10 hover:border-white/25"
            }`}
          >
            <div className="font-mono text-gray-500">#{g.id}</div>
            <div className="truncate text-gray-300">{g.product_label || g.model_id}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
