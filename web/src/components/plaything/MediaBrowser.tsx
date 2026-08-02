"use client";

import type { PlaythingMediaKind } from "@/lib/plaything-categories";
import type { PlaythingGen } from "./types";
import { ImageAlbum } from "./ImageAlbum";
import { VideoLibrary } from "./VideoLibrary";
import { AudioLibrary } from "./AudioLibrary";
import { Model3DViewer } from "./Model3DViewer";
import { useTranslations } from "next-intl";

export function MediaBrowser({
  mediaKind,
  items,
  selectedId,
  onSelect,
  onReuse,
}: {
  mediaKind: PlaythingMediaKind;
  items: PlaythingGen[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  /** 套用（run=false）/ 重新生成（run=true） */
  onReuse?: (id: number, run: boolean) => void;
}) {
  const t = useTranslations("Plaything");
  // 各子视图在未指定选中项时会自己默认选第一条成功作品，
  // 操作按钮要对齐这个行为，否则刚进页面时按钮会整排消失
  const activeId =
    selectedId ?? items.find((g) => g.status === "succeeded" && g.result_urls?.length)?.id ?? null;
  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-4 border-b border-white/10 px-1 mb-3">
        <span className="text-sm font-medium text-white border-b-2 border-orange-500 pb-2">
          {t("myGenerations")}
        </span>
        <span className="text-sm text-gray-600 pb-2 cursor-default" title={t("comingSoon")}>
          {t("examples")}
        </span>
      </div>
      <div
        className="mb-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-100/90 leading-relaxed"
        role="status"
      >
        <i className="fas fa-triangle-exclamation mr-1.5 text-amber-400" />
        {t("retentionNotice")}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {mediaKind === "video" && (
          <VideoLibrary items={items} selectedId={selectedId} onSelect={onSelect} />
        )}
        {mediaKind === "audio" && (
          <AudioLibrary items={items} selectedId={selectedId} onSelect={onSelect} />
        )}
        {mediaKind === "3d" && (
          <Model3DViewer items={items} selectedId={selectedId} onSelect={onSelect} />
        )}
        {mediaKind === "image" && (
          <ImageAlbum items={items} selectedId={selectedId} onSelect={onSelect} />
        )}
      </div>
      {onReuse && activeId != null && (
        <div className="mt-3 flex gap-2 border-t border-white/10 pt-3">
          <button
            type="button"
            onClick={() => onReuse(activeId, false)}
            className="flex-1 rounded-xl border border-white/10 bg-white/5 py-2.5 text-xs hover:bg-white/10"
          >
            <i className="fas fa-rotate-left mr-1.5" />
            {t("reuse")}
          </button>
          <button
            type="button"
            onClick={() => onReuse(activeId, true)}
            className="flex-1 rounded-xl bg-orange-600 py-2.5 text-xs font-semibold hover:bg-orange-500"
          >
            <i className="fas fa-rotate-right mr-1.5" />
            {t("retry")}
          </button>
        </div>
      )}
    </div>
  );
}
