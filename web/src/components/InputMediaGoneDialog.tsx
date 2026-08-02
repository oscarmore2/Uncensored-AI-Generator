"use client";

import { useLocale, useTranslations } from "next-intl";

export type ReuseMediaItem = {
  url: string;
  available: boolean;
  filename: string | null;
  uploaded_at: string | null;
  deleted_at: string | null;
  delete_reason: string | null;
};

/**
 * 「当初的输入媒体已经不在了」的说明框。
 *
 * 用户点确定后才会继续跳转——参数照填，媒体留空由用户自己重新上传。
 * 逐条列出文件名 / 上传时间 / 删除时间 / 删除原因，让用户能对上是哪一个文件。
 */
export function InputMediaGoneDialog({
  items,
  unrecorded,
  onConfirm,
  onCancel,
}: {
  items: ReuseMediaItem[];
  /** 老任务压根没留下媒体台账，与「传过但被清理」要分开说 */
  unrecorded?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("Reuse");
  const locale = useLocale();
  const gone = items.filter((i) => !i.available);

  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(locale) : t("unknownTime");

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/80 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="modal-pop w-full max-w-lg overflow-hidden rounded-3xl border border-amber-500/25 bg-[#111]">
        <div className="flex items-start gap-3 border-b border-white/10 p-5">
          <i className="fas fa-triangle-exclamation mt-0.5 text-xl text-amber-400" />
          <div>
            <h2 className="text-lg font-bold">{t("goneTitle")}</h2>
            <p className="mt-1 text-sm text-gray-400">
              {unrecorded ? t("goneUnrecordedHint") : t("goneHint")}
            </p>
          </div>
        </div>

        {gone.length > 0 && (
          <div className="max-h-[45vh] space-y-3 overflow-y-auto p-5">
            {gone.map((item) => (
              <div
                key={item.url}
                className="rounded-2xl border border-white/10 bg-black/40 p-4 text-sm"
              >
                <div className="mb-2 flex items-center gap-2 font-medium">
                  <i className="fas fa-file-image text-gray-500" />
                  <span className="truncate">{item.filename ?? t("unknownFilename")}</span>
                </div>
                <dl className="space-y-1 text-xs text-gray-400">
                  <div className="flex justify-between gap-3">
                    <dt>{t("uploadedAt")}</dt>
                    <dd className="text-gray-300">{fmt(item.uploaded_at)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt>{t("deletedAt")}</dt>
                    <dd className="text-gray-300">{fmt(item.deleted_at)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt>{t("deleteReason")}</dt>
                    <dd className="text-right text-gray-300">
                      {t.has(`reasons.${item.delete_reason}`)
                        ? t(`reasons.${item.delete_reason}` as "reasons.unknown")
                        : t("reasons.unknown")}
                    </dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-3 border-t border-white/10 p-5">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-2xl border border-white/10 bg-white/5 py-3 text-sm"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 rounded-2xl bg-white py-3 text-sm font-semibold text-black"
          >
            {t("confirmContinue")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 「重新生成」发单前的扣点确认 */
export function RetryConfirmDialog({
  cost,
  balance,
  onConfirm,
  onCancel,
}: {
  cost: number;
  balance: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("Reuse");
  const insufficient = cost > balance;

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/80 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="modal-pop w-full max-w-sm overflow-hidden rounded-3xl border border-white/10 bg-[#111]">
        <div className="p-6 text-center">
          <i className="fas fa-rotate-right text-2xl text-rose-400" />
          <h2 className="mt-3 text-lg font-bold">{t("retryTitle")}</h2>
          <p className="mt-2 text-sm text-gray-400">{t("retryCost", { cost })}</p>
          <p className="mt-1 text-xs text-gray-500">{t("retryBalance", { balance })}</p>
          {insufficient && (
            <p className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              {t("retryInsufficient")}
            </p>
          )}
        </div>
        <div className="flex gap-3 border-t border-white/10 p-5">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-2xl border border-white/10 bg-white/5 py-3 text-sm"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={insufficient}
            className="flex-1 rounded-2xl bg-rose-600 py-3 text-sm font-semibold hover:bg-rose-500 disabled:opacity-40"
          >
            {t("retryConfirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
