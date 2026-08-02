"use client";

import { useEffect, useMemo } from "react";
import { MediaThumb } from "@/components/MediaPreview";
import { EmptyState } from "./ImageAlbum";
import { detectMediaKindFromUrl } from "@/lib/plaything-categories";
import { useModelViewerDiagnostics } from "@/lib/model-viewer-diagnostics";
import type { PlaythingGen } from "./types";
import { MediaExpiryBadge } from "@/components/MediaExpiryBadge";
import { useTranslations } from "next-intl";

export function Model3DViewer({
  items,
  selectedId,
  onSelect,
}: {
  items: PlaythingGen[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const t = useTranslations("Plaything");
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

  const { ref: viewerRef, error: loadError } = useModelViewerDiagnostics(modelUrl);

  if (!items.length) {
    return <EmptyState title={t("no3d")} hint={t("threeDHint")} />;
  }

  return (
    <div className="flex flex-col lg:flex-row gap-4 min-h-[320px]">
      <div className="flex-1 rounded-2xl border border-white/10 bg-[#0c0c0c] overflow-hidden min-h-[280px] relative">
        {modelUrl ? (
          <>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <model-viewer
              ref={viewerRef as any}
              src={modelUrl}
              alt={t("threeDAlt")}
              camera-controls
              touch-action="pan-y"
              auto-rotate
              style={{ width: "100%", height: "min(60vh, 520px)", background: "#0c0c0c" }}
            />
            {loadError && (
              <div className="absolute bottom-2 left-2 right-2 flex items-start gap-2 rounded-xl bg-amber-950/90 border border-amber-500/30 px-3 py-2 text-[11px] text-amber-200">
                <i className="fas fa-triangle-exclamation mt-0.5 shrink-0" />
                <span>
                  {t("threeDLoadWarning")}
                  <span className="block text-amber-400/70 font-mono mt-0.5 break-all">{loadError}</span>
                </span>
              </div>
            )}
          </>
        ) : selected?.result_urls?.length ? (
          <div className="p-6 text-sm text-gray-400 space-y-3">
            <p>{t("threeDDownload")}</p>
            <ul className="space-y-2">
              {selected.result_urls.map((u) => (
                <li key={u}>
                  <a
                    href={u}
                    target="_blank"
                    rel="noreferrer"
                    className="text-orange-400 hover:underline break-all"
                  >
                    {u}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-gray-500">
            {t("select3d")}
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
                ? "border-orange-500/40 bg-orange-500/10"
                : "border-white/10 hover:border-white/25"
            }`}
          >
            <div className="flex items-center gap-2">
              {/* .glb 抽不出首帧，用当初的输入图当封面，没有就退回立方体图标 */}
              <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-[#111]">
                <MediaThumb urls={null} fallbackUrls={g.input_urls} showInputBadge={false} />
                {!g.input_urls?.length && (
                  <i className="fas fa-cube absolute inset-0 flex items-center justify-center text-gray-600" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-gray-500">#{g.id}</span>
                <span className="block truncate text-gray-300">
                  {g.product_label || g.model_id}
                </span>
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
