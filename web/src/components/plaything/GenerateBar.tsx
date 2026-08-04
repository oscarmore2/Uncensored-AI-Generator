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
  quoteSource?: "provider" | "fallback" | null;
  quoting?: boolean;
  onGenerate: () => void;
  onTopUp: () => void;
}) {
  const t = useTranslations("Plaything");
  const busy = phase !== "idle";
  // 报价还在防抖期间不判定余额，避免用旧报价误报「不足」
  const insufficient = !busy && !quoting && creditCost > balance;
  const label =
    phase === "idle"
      ? quoting
        ? t("quoting")
        : insufficient
          ? t("insufficientShort")
          : t("generate", { credits: creditCost })
      : phase === "submitting"
        ? t("uploading")
        : t("progress", { progress });

  return (
    <div className="space-y-2 pt-2 border-t border-line">
      {insufficient && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/25 px-3 py-2 text-[11px] text-amber-800 flex items-start gap-1.5">
          <i className="fas fa-coins mt-0.5 shrink-0" />
          <span>{t("insufficientCredits", { cost: creditCost, balance })}</span>
        </div>
      )}
      <button
        type="button"
        disabled={busy || disabled || quoting || insufficient}
        onClick={onGenerate}
        className="w-full py-3 rounded-2xl text-sm font-semibold bg-orange-700 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-white"
      >
        {label}
      </button>
      {phase === "polling" && (
        <div className="h-1.5 rounded-full bg-black/[0.06] overflow-hidden">
          <div
            className="h-full bg-orange-500 transition-all"
            style={{ width: `${Math.max(5, progress)}%` }}
          />
        </div>
      )}
      <div className="flex items-center justify-between text-xs text-ink-subtle gap-2">
        <span>
          {t("balance")} <span className="font-mono text-ink-muted">{balance}</span> {t("credits")} · {t("noDiscount")}
          {quoteSource === "provider" && (
            <span className="text-emerald-500/80 ml-1">· {t("dynamicPrice")}</span>
          )}
          {quoteSource === "fallback" && (
            <span className="text-amber-500/80 ml-1">· {t("basePrice")}</span>
          )}
        </span>
        <button type="button" onClick={onTopUp} className="text-orange-700 hover:text-orange-800 shrink-0">
          {t("topUp")}
        </button>
      </div>
    </div>
  );
}
