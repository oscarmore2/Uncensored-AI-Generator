"use client";

import type { Phase } from "./types";

export function GenerateBar({
  creditCost,
  balance,
  phase,
  progress,
  disabled,
  onGenerate,
  onTopUp,
}: {
  creditCost: number;
  balance: number;
  phase: Phase;
  progress: number;
  disabled?: boolean;
  onGenerate: () => void;
  onTopUp: () => void;
}) {
  const busy = phase !== "idle";
  const label =
    phase === "idle"
      ? `生成 · ${creditCost} 点`
      : phase === "submitting"
        ? "提交中…"
        : `生成中 ${progress}%`;

  return (
    <div className="space-y-2 pt-2 border-t border-white/10">
      <button
        type="button"
        disabled={busy || disabled}
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
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>
          余额 <span className="font-mono text-gray-300">{balance}</span> 点 · 无 VIP 折扣
        </span>
        <button type="button" onClick={onTopUp} className="text-rose-400 hover:text-rose-300">
          充值
        </button>
      </div>
    </div>
  );
}
