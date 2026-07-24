"use client";

import type { PlaythingProduct } from "./types";

export function ModelPicker({
  products,
  selectedId,
  onSelect,
}: {
  products: PlaythingProduct[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const selected = products.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="space-y-2">
      <label className="text-xs text-gray-400 block">模型</label>
      <div className="relative">
        <select
          value={selectedId ?? ""}
          onChange={(e) => onSelect(Number(e.target.value))}
          className="w-full appearance-none bg-[#111] border border-white/10 rounded-2xl pl-3 pr-10 py-2.5 text-sm outline-none focus:border-rose-500/40"
        >
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.is_recommended ? "★ " : ""}
              {p.label} · {p.credit_cost} 点
            </option>
          ))}
        </select>
        <i className="fas fa-chevron-down absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 pointer-events-none" />
      </div>
      {selected && (
        <div className="flex gap-3 items-start">
          <div className="w-16 h-12 rounded-xl overflow-hidden bg-[#151515] shrink-0">
            {selected.thumbnail_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={selected.thumbnail_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-600 font-black">
                {selected.label.slice(0, 1)}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium flex items-center gap-2">
              {selected.label}
              {selected.is_recommended && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">
                  推荐
                </span>
              )}
            </div>
            <p className="text-[10px] text-gray-500 font-mono truncate">{selected.model_id}</p>
            {selected.description && (
              <p className="text-xs text-gray-500 mt-1 line-clamp-2">{selected.description}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
