"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { api, ApiError } from "@/lib/client";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";

/**
 * 分享按钮。点开拿到一条公开链接，发到微信/朋友圈都行。
 *
 * 两种来源走两条路：
 * - 公共作品本来就人人可见，链接直接由 id 拼出来，不必往服务端跑一趟
 * - 私有作品要先跟服务端换一个随机令牌（顺便由服务端把成人作品、
 *   未完成、媒体已清理这几种挡掉）
 *
 * 没有做「调起微信转发面板」：那要公众号 appId + JS 安全域名 + 服务端签名，
 * 手上没有这套。分享页配了 og 标签，用户在微信里点「···」转发，卡片能正常显示。
 */
export function ShareButton({
  kind,
  id,
  className = "",
}: {
  kind: "generation" | "work";
  id: number;
  className?: string;
}) {
  const t = useTranslations("Share");
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useBodyScrollLock(open);

  const start = useCallback(async () => {
    setError(null);
    setCopied(false);
    setOpen(true);

    if (kind === "work") {
      setUrl(`${window.location.origin}/s/w/${id}`);
      return;
    }

    setBusy(true);
    try {
      const res = await api<{ url: string }>(`/api/generations/${id}/share`, { method: "POST" });
      setUrl(res.url);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : undefined;
      setError(
        code === "ADULT_NOT_SHAREABLE"
          ? t("shareAdultBlocked")
          : code === "NOT_READY"
            ? t("shareNotReady")
            : code === "MEDIA_GONE"
              ? t("shareMediaGone")
              : e instanceof Error
                ? e.message
                : t("shareFailed")
      );
    } finally {
      setBusy(false);
    }
  }, [id, kind, t]);

  const copy = useCallback(async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // 剪贴板被拒（http 或用户没授权）时不报错：链接就在框里，选中复制也一样
      setCopied(false);
    }
  }, [url]);

  const revoke = useCallback(async () => {
    setBusy(true);
    try {
      await api(`/api/generations/${id}/share`, { method: "DELETE" });
      setUrl(null);
      setError(t("shareRevoked"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("shareFailed"));
    } finally {
      setBusy(false);
    }
  }, [id, t]);

  return (
    <>
      <button
        type="button"
        onClick={() => void start()}
        className={className || "flex items-center gap-x-2 rounded-2xl border border-line px-4 py-2 text-sm hover:bg-black/[0.04]"}
      >
        <i className="fas fa-share-nodes" /> {t("shareButton")}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={t("shareTitle")}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="w-full max-w-md overflow-hidden rounded-3xl border border-line bg-surface shadow-2xl">
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 className="text-sm font-semibold">{t("shareTitle")}</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("shareCopy")}
                className="flex h-8 w-8 items-center justify-center rounded-xl border border-line text-xs text-ink-subtle hover:text-ink"
              >
                <i className="fas fa-times" />
              </button>
            </div>

            <div className="p-5">
              {busy && <p className="text-sm text-ink-muted">{t("shareCreating")}</p>}

              {!busy && error && (
                <p className="rounded-2xl bg-amber-500/10 px-4 py-3 text-sm text-amber-800">
                  <i className="fas fa-circle-info mr-1.5" />
                  {error}
                </p>
              )}

              {!busy && url && (
                <>
                  <input
                    readOnly
                    value={url}
                    onFocus={(e) => e.currentTarget.select()}
                    className="w-full rounded-2xl border border-line bg-stage px-4 py-2.5 text-xs outline-none"
                  />
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void copy()}
                      className="flex flex-1 items-center justify-center gap-x-2 rounded-2xl bg-orange-700 py-2.5 text-sm font-semibold text-white hover:bg-orange-600"
                    >
                      <i className={`fas ${copied ? "fa-check" : "fa-copy"}`} />
                      {copied ? t("shareCopied") : t("shareCopy")}
                    </button>
                    {kind === "generation" && (
                      <button
                        type="button"
                        onClick={() => void revoke()}
                        className="rounded-2xl border border-line px-4 py-2.5 text-sm text-ink-muted hover:text-red-700"
                      >
                        {t("shareRevoke")}
                      </button>
                    )}
                  </div>
                  <p className="mt-3 text-[11px] leading-relaxed text-ink-subtle">
                    {t("shareHint")}
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-ink-subtle">
                    <i className="fab fa-weixin mr-1 text-emerald-600" />
                    {t("shareWechatHint")}
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
