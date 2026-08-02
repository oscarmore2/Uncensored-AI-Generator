"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

function countdown(
  expiresAt: string,
  t: (key: "waiting" | "days" | "hours" | "minutes", values?: Record<string, number>) => string
): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return t("waiting");
  const totalMinutes = Math.ceil(ms / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return t("days", { days, hours });
  if (hours > 0) return t("hours", { hours, minutes });
  return t("minutes", { minutes });
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
  const t = useTranslations("MediaExpiry");
  const [, tick] = useState(0);
  useEffect(() => {
    if (!expiresAt || deletedAt) return;
    const timer = window.setInterval(() => tick((value) => value + 1), 60_000);
    return () => window.clearInterval(timer);
  }, [deletedAt, expiresAt]);

  const label = deletedAt ? t("deleted") : expiresAt ? countdown(expiresAt, t) : t("permanent");
  const color = deletedAt
    ? "bg-black/[0.06] text-ink-subtle"
    : expiresAt
      ? "bg-amber-500/15 text-amber-800 border border-amber-400/25"
      : "bg-emerald-500/15 text-emerald-700 border border-emerald-400/20";
  return (
    <span className={`inline-flex items-center rounded-full ${color} ${compact ? "px-2 py-0.5 text-[9px]" : "px-3 py-1 text-xs"}`}>
      <i className={`fas ${deletedAt ? "fa-trash-can" : expiresAt ? "fa-clock" : "fa-infinity"} mr-1.5`} />
      {label}
    </span>
  );
}
