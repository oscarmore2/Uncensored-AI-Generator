"use client";

import { useEffect, useMemo, useState } from "react";
import type { PlaythingProduct } from "./types";
import { useTranslations } from "next-intl";
import { PROVIDER_META, type ProviderId } from "@/lib/providers/meta";

/**
 * 模型选择器 + 渠道筛选。
 *
 * 筛选条只在当前品类下真的有两家模型时才出现：只有一家时多一行永远只有一个
 * 选项的筛选器，纯属噪音。
 */

const CHIP_ACTIVE: Record<ProviderId, string> = {
  wavespeed: "bg-sky-500/20 border-sky-500/50 text-sky-800",
  atlas: "bg-violet-500/20 border-violet-500/50 text-violet-800",
};

export function ModelPicker({
  products,
  selectedId,
  onSelect,
}: {
  products: PlaythingProduct[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const t = useTranslations("Plaything");
  const [provider, setProvider] = useState<ProviderId | null>(null);

  const available = useMemo(() => {
    const counts = new Map<ProviderId, number>();
    for (const p of products) counts.set(p.provider, (counts.get(p.provider) ?? 0) + 1);
    return counts;
  }, [products]);

  const visible = useMemo(
    () => (provider ? products.filter((p) => p.provider === provider) : products),
    [products, provider]
  );

  // 换品类后旧的渠道筛选可能在新品类下一个模型都没有，留着就是一片空白
  useEffect(() => {
    if (provider && !available.has(provider)) setProvider(null);
  }, [provider, available]);

  // 筛掉了当前选中的模型时顺手选中列表第一个，避免右侧参数区空着
  useEffect(() => {
    if (!visible.length) return;
    if (!visible.some((p) => p.id === selectedId)) onSelect(visible[0].id);
  }, [visible, selectedId, onSelect]);

  const selected = products.find((p) => p.id === selectedId) ?? null;
  const selectedMeta = selected ? PROVIDER_META[selected.provider] : null;

  return (
    <div className="space-y-2">
      <label className="text-xs text-ink-muted block">{t("model")}</label>

      {available.size > 1 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setProvider(null)}
            className={`px-2.5 py-1 text-[11px] rounded-full border transition-colors ${
              provider === null
                ? "bg-orange-500/15 border-orange-500/50 text-orange-800"
                : "border-line text-ink-muted hover:text-ink"
            }`}
          >
            {t("allProviders")} {products.length}
          </button>
          {[...available.entries()].map(([id, count]) => (
            <button
              key={id}
              type="button"
              onClick={() => setProvider(provider === id ? null : id)}
              className={`px-2.5 py-1 text-[11px] rounded-full border transition-colors ${
                provider === id ? CHIP_ACTIVE[id] : "border-line text-ink-muted hover:text-ink"
              }`}
            >
              {PROVIDER_META[id].shortLabel} {count}
            </button>
          ))}
        </div>
      )}

      <div className="relative">
        <select
          value={selectedId ?? ""}
          onChange={(e) => onSelect(Number(e.target.value))}
          className="w-full appearance-none bg-surface border border-line rounded-2xl pl-3 pr-10 py-2.5 text-sm outline-none focus:border-orange-500/40"
        >
          {visible.map((p) => (
            <option key={p.id} value={p.id}>
              {p.is_recommended ? "★ " : ""}
              {p.label} · {p.credit_cost} {t("credits")}
            </option>
          ))}
        </select>
        <i className="fas fa-chevron-down absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-subtle pointer-events-none" />
      </div>

      {selected && (
        <div className="flex gap-3 items-start">
          <div className="w-16 h-12 rounded-xl overflow-hidden bg-[#151515] shrink-0">
            {selected.thumbnail_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={selected.thumbnail_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-ink-subtle font-black">
                {selected.label.slice(0, 1)}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
              {selected.label}
              {selected.is_recommended && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-800">
                  {t("recommended")}
                </span>
              )}
              {selectedMeta && available.size > 1 && (
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded border ${CHIP_ACTIVE[selected.provider]}`}
                >
                  {selectedMeta.shortLabel}
                </span>
              )}
            </div>
            <p className="text-[10px] text-ink-subtle font-mono truncate">{selected.model_id}</p>
            {selected.description && (
              <p className="text-xs text-ink-subtle mt-1 line-clamp-2">{selected.description}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
