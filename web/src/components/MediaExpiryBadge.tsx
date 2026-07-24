"use client";

import { useEffect, useState } from "react";

function countdown(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "等待清理";
  const totalMinutes = Math.ceil(ms / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}天 ${hours}小时后清理`;
  if (hours > 0) return `${hours}小时 ${minutes}分钟后清理`;
  return `${minutes}分钟后清理`;
}

export function MediaExpiryBadge({
  expiresAt,
  deletedAt,
  compact = false,
}: {
  expiresAt: string | null;
  deletedAt: string | null;
  compact?: boolean;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!expiresAt || deletedAt) return;
    const timer = window.setInterval(() => tick((value) => value + 1), 60_000);
    return () => window.clearInterval(timer);
  }, [deletedAt, expiresAt]);

  const label = deletedAt ? "媒体已清理" : expiresAt ? countdown(expiresAt) : "永久保留";
  const color = deletedAt
    ? "bg-gray-700/80 text-gray-300"
    : expiresAt
      ? "bg-amber-500/15 text-amber-200 border border-amber-400/25"
      : "bg-emerald-500/15 text-emerald-200 border border-emerald-400/20";
  return (
    <span className={`inline-flex items-center rounded-full ${color} ${compact ? "px-2 py-0.5 text-[9px]" : "px-3 py-1 text-xs"}`}>
      <i className={`fas ${deletedAt ? "fa-trash-can" : expiresAt ? "fa-clock" : "fa-infinity"} mr-1.5`} />
      {label}
    </span>
  );
}
