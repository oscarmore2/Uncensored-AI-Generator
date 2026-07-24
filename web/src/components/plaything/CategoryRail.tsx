"use client";

import type { PlaythingCategorySummary } from "./types";
import type { PlaythingCategoryId } from "@/lib/plaything-categories";

export function CategoryRail({
  categories,
  active,
  onChange,
}: {
  categories: PlaythingCategorySummary[];
  active: PlaythingCategoryId | null;
  onChange: (id: PlaythingCategoryId) => void;
}) {
  return (
    <nav
      className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible shrink-0 lg:w-[72px] pb-1 lg:pb-0"
      aria-label="玩物品类"
    >
      {categories.map((c) => {
        const selected = c.id === active;
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onChange(c.id)}
            title={`${c.label} (${c.count})`}
            className={`flex flex-col items-center justify-center gap-1 min-w-[64px] lg:min-w-0 px-2 py-3 rounded-2xl text-[10px] font-medium transition-colors ${
              selected
                ? "bg-rose-600/20 text-rose-200 border border-rose-500/40"
                : "text-gray-400 hover:text-white hover:bg-white/5 border border-transparent"
            }`}
          >
            <i className={`fas ${c.icon} text-base`} />
            <span>{c.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
