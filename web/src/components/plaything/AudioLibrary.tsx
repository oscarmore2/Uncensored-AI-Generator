"use client";

import { EmptyState } from "./ImageAlbum";
import type { PlaythingGen } from "./types";
import { MediaExpiryBadge } from "@/components/MediaExpiryBadge";
import { buildWorkGallery } from "@/lib/plaything-categories";
import { useTranslations } from "next-intl";

export function AudioLibrary({
  items,
  selectedId,
  onSelect,
}: {
  items: PlaythingGen[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const t = useTranslations("Plaything");
  const succeeded = items.filter((g) => g.status === "succeeded" && g.result_urls?.length);
  const selected = succeeded.find((g) => g.id === selectedId) ?? succeeded[0] ?? null;
  // 同 VideoLibrary：结果里可能还有一张封面，[0] 未必是音频本体
  const url = selected
    ? (buildWorkGallery(selected.result_urls, undefined, "audio").items[0]?.url ?? null)
    : null;

  if (!items.length) {
    return <EmptyState title={t("noAudio")} hint={t("audioHint")} />;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-line bg-black/[0.03] p-5">
        {url ? (
          <>
            <p className="text-sm text-ink-muted mb-3">
              #{selected!.id} · {selected!.product_label || selected!.model_id}
              {selected!.is_adult ? " · 18+" : ""}
            </p>
            <div className="mb-3">
              <MediaExpiryBadge
                expiresAt={selected!.media_expires_at}
                deletedAt={selected!.media_deleted_at}
                compact
              />
            </div>
            <audio key={url} src={url} controls className="w-full" />
          </>
        ) : (
          <p className="text-sm text-ink-subtle">{t("selectAudio")}</p>
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
                  ? "border-orange-500/40 bg-orange-500/10"
                  : "border-line hover:border-line-strong"
              }`}
            >
              <span className="font-mono text-xs text-ink-subtle mr-2">#{g.id}</span>
              {g.product_label || g.model_id}
            </button>
          </li>
        ))}
        {items
          .filter((g) => g.status !== "succeeded")
          .map((g) => (
            <li key={g.id} className="text-xs text-ink-subtle px-3">
              #{g.id} · {g.status}
              {g.error ? ` · ${g.error.slice(0, 60)}` : ""}
            </li>
          ))}
      </ul>
    </div>
  );
}
