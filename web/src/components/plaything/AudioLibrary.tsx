"use client";

import { EmptyState } from "./ImageAlbum";
import type { PlaythingGen } from "./types";

export function AudioLibrary({
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
  const url = selected?.result_urls?.[0] ?? null;

  if (!items.length) {
    return <EmptyState title="还没有音频" hint="选择音频模型并生成后，将在此播放" />;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        {url ? (
          <>
            <p className="text-sm text-gray-300 mb-3">
              #{selected!.id} · {selected!.product_label || selected!.model_id}
            </p>
            <audio key={url} src={url} controls className="w-full" />
          </>
        ) : (
          <p className="text-sm text-gray-500">选择一条音频开始播放</p>
        )}
      </div>
      <ul className="space-y-2">
        {succeeded.map((g) => (
          <li key={g.id}>
            <button
              type="button"
              onClick={() => onSelect(g.id)}
              className={`w-full text-left rounded-xl px-3 py-2.5 text-sm border ${
                g.id === selected?.id
                  ? "border-rose-500/40 bg-rose-500/10"
                  : "border-white/10 hover:border-white/25"
              }`}
            >
              <span className="font-mono text-xs text-gray-500 mr-2">#{g.id}</span>
              {g.product_label || g.model_id}
            </button>
          </li>
        ))}
        {items
          .filter((g) => g.status !== "succeeded")
          .map((g) => (
            <li key={g.id} className="text-xs text-gray-500 px-3">
              #{g.id} · {g.status}
              {g.error ? ` · ${g.error.slice(0, 60)}` : ""}
            </li>
          ))}
      </ul>
    </div>
  );
}
