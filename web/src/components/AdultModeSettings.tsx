"use client";

import Link from "next/link";
import { useState } from "react";
import { api, type ApiUser } from "@/lib/client";
import { useApp } from "./AppContext";
import { useTranslations } from "next-intl";

export function AdultModeSettings() {
  const t = useTranslations("AdultMode");
  const { user, refreshUser, toast } = useApp();
  const [gateOpen, setGateOpen] = useState(false);
  const [birthDate, setBirthDate] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  async function disable() {
    if (busy) return;
    setBusy(true);
    try {
      await api<ApiUser>("/api/me/adult-mode", {
        method: "PATCH",
        body: JSON.stringify({ enabled: false }),
      });
      await refreshUser();
      toast(t("disabled"));
    } catch (error) {
      toast(error instanceof Error ? error.message : t("settingFailed"), true);
    } finally {
      setBusy(false);
    }
  }

  async function enable() {
    if (!birthDate || !confirmed || busy) return;
    setBusy(true);
    try {
      await api<ApiUser>("/api/me/adult-mode", {
        method: "PATCH",
        body: JSON.stringify({
          enabled: true,
          birth_date: birthDate,
          confirm_adult: true,
        }),
      });
      await refreshUser();
      setGateOpen(false);
      toast(t("enabled"));
    } catch (error) {
      toast(error instanceof Error ? error.message : t("verificationFailed"), true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="glass rounded-3xl p-6 mt-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <i className="fas fa-shield-halved text-teal-700" />
              <h3 className="font-semibold">{t("title")}</h3>
              {user.adult_mode_enabled && (
                <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold text-red-700">
                  18+
                </span>
              )}
            </div>
            <p className="mt-2 max-w-xl text-sm leading-6 text-ink-muted">
              {t("description")}
            </p>
          </div>
          {user.is_vip ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => user.adult_mode_enabled ? void disable() : setGateOpen(true)}
              className={`shrink-0 rounded-2xl px-5 py-2.5 text-sm font-semibold disabled:opacity-50 ${
                user.adult_mode_enabled
                  ? "border border-line text-ink hover:bg-black/[0.04]"
                  : "bg-teal-700 text-white hover:bg-teal-700"
              }`}
            >
              {user.adult_mode_enabled ? t("disable") : t("enable")}
            </button>
          ) : (
            <Link
              href="/pricing?tab=vip"
              className="shrink-0 rounded-2xl bg-amber-400 px-5 py-2.5 text-sm font-bold text-black hover:bg-amber-300"
            >
              {t("upgrade")}
            </Link>
          )}
        </div>
      </section>

      {gateOpen && (
        <div
          className="fixed inset-0 z-[210] flex items-center justify-center scrim p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="adult-gate-title"
        >
          <div className="modal-pop w-full max-w-md rounded-3xl border border-red-500/25 bg-[#151116] p-7 shadow-2xl">
            <div className="mb-5 flex items-start justify-between">
              <div>
                <div className="mb-3 inline-flex rounded-2xl bg-red-500/15 px-3 py-1 text-xs font-bold text-red-700">
                  {t("gate")}
                </div>
                <h2 id="adult-gate-title" className="text-2xl font-bold">{t("gateTitle")}</h2>
              </div>
              <button type="button" onClick={() => setGateOpen(false)} className="text-2xl text-ink-subtle hover:text-ink">
                &times;
              </button>
            </div>
            <p className="mb-5 text-sm leading-6 text-ink-muted">
              {t("gateDescription")}
            </p>
            <label className="text-sm text-ink-muted">
              {t("birthDate")}
              <input
                type="date"
                value={birthDate}
                onChange={(event) => setBirthDate(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-line bg-black/[0.04] px-4 py-3 outline-none focus:border-red-400/60"
              />
            </label>
            <label className="mt-4 flex cursor-pointer items-start gap-3 text-xs leading-5 text-ink-muted">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                className="mt-1 h-4 w-4 accent-red-500"
              />
              <span>{t("confirmation")}</span>
            </label>
            <button
              type="button"
              disabled={!birthDate || !confirmed || busy}
              onClick={() => void enable()}
              className="mt-6 w-full rounded-2xl bg-red-700 py-3 font-bold text-white hover:bg-red-400 disabled:opacity-40"
            >
              {busy ? t("verifying") : t("confirm")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
