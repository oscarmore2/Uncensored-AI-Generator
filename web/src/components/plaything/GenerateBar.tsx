"use client";

import type { Phase } from "./types";
import { useTranslations } from "next-intl";

export function GenerateBar({
  creditCost,
  balance,
  phase,
  progress,
  disabled,
  quoteSource,
  quoting,
  onGenerate,
  onTopUp,
}: {
  creditCost: number;
  balance: number;
  phase: Phase;
  progress: number;
  disabled?: boolean;
  quoteSource?: "wavespeed" | "fallback" | null;
  quoting?: boolean;
  onGenerate: () => void;
  onTopUp: () => void;
}) {
  const t = useTranslations("Plaything");
  const busy = phase !== "idle";
  const label =
    phase === "idle"
      ? quoting
        ? t("quoting")
        : t("generate", { credits: creditCost })
      : phase === "submitting"
        ? t("uploading")
        : t("progress", { progress });

  return (
    <div className="space-y-2 pt-2 border-t border-white/10">
      <button
        type="button"
        disabled={busy || disabled || quoting}
        onClick={onGenerate}
        className="w-full py-3 rounded-2xl text-sm font-semibold bg-rose-600 hover:bg-rose-500 disabled:opacity-50 transition-colors"
      >
        {label}
      </button>
      {phase === "polling" && (
        <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full bg-rose-500 transition-all"
            style={{ width: `${Math.max(5, progress)}%` }}
          />
        </div>
      )}
      <div className="flex items-center justify-between text-xs text-gray-500 gap-2">
        <span>
          {t("balance")} <span className="font-mono text-gray-300">{balance}</span> {t("credits")} · {t("noDiscount")}
          {quoteSource === "wavespeed" && (
            <span className="text-emerald-500/80 ml-1">· {t("dynamicPrice")}</span>
          )}
          {quoteSource === "fallback" && (
            <span className="text-amber-500/80 ml-1">· {t("basePrice")}</span>
          )}
        </span>
        <button type="button" onClick={onTopUp} className="text-rose-400 hover:text-rose-300 shrink-0">
          {t("topUp")}
        </button>
      </div>
    </div>
  );
}
