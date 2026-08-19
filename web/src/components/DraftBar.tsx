"use client";

import { useTranslations } from "next-intl";

/**
 * 生成页的草稿工具条。
 *
 * 保存与恢复对所有人开放；自动保存与另存为是 VIP 功能——前端只是不给入口，
 * 真正的门在服务端（/api/me/draft-autosave 与 POST /api/drafts 的 save_as）。
 *
 * 生成执行期间保存整体暂停：那一刻的内容已经交给上游了，再写草稿会让
 * 「这条草稿对应哪次生成」说不清。生成失败回到可编辑状态，保存自然回来。
 */
export function DraftBar({
  isVip,
  autoSave,
  onToggleAutoSave,
  dirty,
  saving,
  lastSavedAt,
  paused,
  canRestore,
  onSave,
  onSaveAs,
  onRestore,
}: {
  isVip: boolean;
  autoSave: boolean;
  onToggleAutoSave: (next: boolean) => void;
  dirty: boolean;
  saving: boolean;
  lastSavedAt: number | null;
  paused: boolean;
  canRestore: boolean;
  onSave: () => void;
  onSaveAs: () => void;
  onRestore: () => void;
}) {
  const t = useTranslations("Make");

  const status = paused
    ? { text: t("draftPausedByRun"), tone: "text-amber-700" }
    : saving
      ? { text: t("draftSaving"), tone: "text-ink-subtle" }
      : dirty
        ? { text: t("draftUnsaved"), tone: "text-ink-subtle" }
        : lastSavedAt
          ? { text: t("draftSaved"), tone: "text-emerald-700" }
          : null;

  return (
    <div className="mb-5 rounded-3xl border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={paused || saving}
          className="flex items-center gap-x-1.5 rounded-2xl bg-black/[0.04] px-3 py-1.5 text-xs hover:bg-black/[0.07] disabled:opacity-40"
        >
          <i className="fas fa-floppy-disk" /> {t("draftSave")}
        </button>

        {isVip && (
          <button
            type="button"
            onClick={onSaveAs}
            disabled={paused || saving}
            className="flex items-center gap-x-1.5 rounded-2xl border border-line px-3 py-1.5 text-xs hover:bg-black/[0.04] disabled:opacity-40"
          >
            <i className="fas fa-copy" /> {t("draftSaveAs")}
          </button>
        )}

        {canRestore && (
          <button
            type="button"
            onClick={onRestore}
            className="flex items-center gap-x-1.5 rounded-2xl border border-line px-3 py-1.5 text-xs hover:bg-black/[0.04]"
          >
            <i className="fas fa-clock-rotate-left" /> {t("draftRestore")}
          </button>
        )}

        <div className="ml-auto flex items-center gap-3">
          {status && <span className={`text-[11px] ${status.tone}`}>{status.text}</span>}

          {isVip ? (
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-muted">
              <input
                type="checkbox"
                checked={autoSave}
                onChange={(e) => onToggleAutoSave(e.target.checked)}
                className="accent-orange-700"
              />
              {t("draftAuto")}
            </label>
          ) : (
            <span className="text-[11px] text-ink-subtle">
              <i className="fas fa-crown mr-1 text-amber-600" />
              {t("draftVipOnly")}
            </span>
          )}
        </div>
      </div>

      <p className="mt-2 text-[11px] text-ink-subtle">
        {isVip && autoSave ? t("draftAutoHint") : t("draftManualHint")}
      </p>
    </div>
  );
}
