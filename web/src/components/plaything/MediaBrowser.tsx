"use client";

import type { PlaythingMediaKind } from "@/lib/plaything-categories";
import type { PlaythingGen } from "./types";
import { ImageAlbum } from "./ImageAlbum";
import { VideoLibrary } from "./VideoLibrary";
import { AudioLibrary } from "./AudioLibrary";
import { Model3DViewer } from "./Model3DViewer";

export function MediaBrowser({
  mediaKind,
  items,
  selectedId,
  onSelect,
}: {
  mediaKind: PlaythingMediaKind;
  items: PlaythingGen[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-4 border-b border-white/10 px-1 mb-4">
        <span className="text-sm font-medium text-white border-b-2 border-rose-500 pb-2">
          我的生成
        </span>
        <span className="text-sm text-gray-600 pb-2 cursor-default" title="暂未提供">
          示例
        </span>
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
    </div>
  );
}
