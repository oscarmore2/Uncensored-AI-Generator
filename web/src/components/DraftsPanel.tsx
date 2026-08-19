"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/lib/client";
import { useApp } from "@/components/AppContext";
import { decodeDraftSnapshot, draftDisplayTitle, type SnapshotMedia } from "@/lib/draft-snapshot";
import type { ApiDraft } from "@/lib/use-server-draft";

/**
 * 「我的草稿」列表。
 *
 * 草稿是**未完成的生成记录**：点一条就跳回它当初那个模式的编辑器，
 * 和「套用」走同一条恢复路径（都是把快照铺回表单）。
 *
 * 打开时先对一次账：挂了任务单的草稿，若那个任务已经跑完就删掉。
 * 主路径是生成成功那一刻就删，但那一步跑在浏览器里，关标签页就丢了。
 */
export function DraftsPanel() {
  const t = useTranslations("History");
  const locale = useLocale();
  const router = useRouter();
  const { toast } = useApp();

  const [items, setItems] = useState<ApiDraft[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      // 先对账再列出，否则会先闪一下那些其实已经完成的草稿
      await api<{ removed: number; unlinked: number }>("/api/drafts/reconcile", {
        method: "POST",
      }).catch(() => null);
      setItems(await api<ApiDraft[]>("/api/drafts"));
    } catch {
      toast(t("draftLoadFailed"), true);
    } finally {
      setLoaded(true);
    }
  }, [t, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = useCallback(
    async (id: number) => {
      if (!window.confirm(t("draftDeleteConfirm"))) return;
      setBusyId(id);
      try {
        await api(`/api/drafts/${id}`, { method: "DELETE" });
        setItems((prev) => prev.filter((d) => d.id !== id));
      } catch {
        toast(t("draftDeleteFailed"), true);
      } finally {
        setBusyId(null);
      }
    },
    [t, toast]
  );

  if (loaded && items.length === 0) {
    return (
      <div className="py-16 text-center">
        <i className="fas fa-pen-ruler mb-4 text-6xl text-ink-subtle" />
        <p className="text-ink-muted">
          {t("draftsEmpty")}
          <br />
          {t("draftsEmptyHint")}
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((draft) => {
        const snap = decodeDraftSnapshot(draft.snapshot);
        const media = Object.values(snap.media).flat();
        return (
          <div
            key={draft.id}
            className="glass flex flex-col overflow-hidden rounded-3xl border border-line"
          >
            <button
              type="button"
              onClick={() => router.push(`/make?draft=${draft.id}`)}
              className="flex-1 p-4 text-left transition-colors hover:bg-black/[0.03]"
            >
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <span className="rounded-full bg-black/60 px-2.5 py-px text-[10px] text-white">
                  {draft.mode}
                </span>
                <span className="rounded-full border border-line px-2 py-px text-[10px] text-ink-subtle">
                  {draft.tier}
                </span>
                {draft.generation_id !== null && (
                  <span className="rounded-full bg-orange-700/15 px-2 py-px text-[10px] text-orange-800">
                    <i className="fas fa-spinner fa-spin mr-1" />
                    {t("draftGenerating")}
                  </span>
                )}
              </div>

              <div className="mb-1 text-xs text-ink-muted">
                {new Date(draft.updated_at).toLocaleString(locale)}
              </div>

              <div className="line-clamp-2 text-sm">
                {draftDisplayTitle(draft.title, draft.prompt, t("draftUntitled"))}
              </div>

              {media.length > 0 && (
                <div className="mt-3 flex gap-1.5">
                  {media.slice(0, 4).map((m, i) => (
                    <DraftThumb key={`${m.id}-${i}`} media={m} />
                  ))}
                  {media.length > 4 && (
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-line text-[10px] text-ink-subtle">
                      +{media.length - 4}
                    </span>
                  )}
                </div>
              )}
            </button>

            <div className="flex gap-2 border-t border-line p-3">
              <button
                type="button"
                onClick={() => router.push(`/make?draft=${draft.id}`)}
                className="flex flex-1 items-center justify-center gap-x-2 rounded-2xl bg-black/[0.03] py-2 text-xs hover:bg-black/[0.06]"
              >
                <i className="fas fa-pen" /> {t("draftContinue")}
              </button>
              <button
                type="button"
                disabled={busyId === draft.id}
                onClick={() => void remove(draft.id)}
                aria-label={t("draftDelete")}
                className="flex h-8 w-8 items-center justify-center rounded-2xl border border-line text-xs text-ink-subtle hover:text-red-700 disabled:opacity-40"
              >
                <i className="fas fa-trash" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DraftThumb({ media }: { media: SnapshotMedia }) {
  const box = "h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-line bg-stage";
  if (media.kind === "image") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={media.url} alt="" className={`${box} object-cover`} />;
  }
  return (
    <span className={`${box} flex items-center justify-center text-ink-subtle`}>
      <i className={`fas ${media.kind === "video" ? "fa-film" : "fa-music"} text-xs`} />
    </span>
  );
}
