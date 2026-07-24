"use client";

import Link from "next/link";
import { useState } from "react";
import { api, type ApiUser } from "@/lib/client";
import { useApp } from "./AppContext";

export function AdultModeSettings() {
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
      toast("成人模式已关闭");
    } catch (error) {
      toast(error instanceof Error ? error.message : "设置失败", true);
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
      toast("已通过成年验证，成人模式已开启");
    } catch (error) {
      toast(error instanceof Error ? error.message : "成年验证失败", true);
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
              <i className="fas fa-shield-halved text-violet-300" />
              <h3 className="font-semibold">内容显示设置</h3>
              {user.adult_mode_enabled && (
                <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold text-red-300">
                  18+
                </span>
              )}
            </div>
            <p className="mt-2 max-w-xl text-sm leading-6 text-gray-400">
              成人模式仅限已通过 18 岁验证的 VIP。开启后可提交敏感提示词，并在探索页看到带有
              18+ 标记的作品；成人媒体默认保持模糊。
            </p>
          </div>
          {user.is_vip ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => user.adult_mode_enabled ? void disable() : setGateOpen(true)}
              className={`shrink-0 rounded-2xl px-5 py-2.5 text-sm font-semibold disabled:opacity-50 ${
                user.adult_mode_enabled
                  ? "border border-white/15 text-gray-200 hover:bg-white/5"
                  : "bg-violet-500 text-white hover:bg-violet-400"
              }`}
            >
              {user.adult_mode_enabled ? "关闭成人模式" : "开启成人模式"}
            </button>
          ) : (
            <Link
              href="/pricing?tab=vip"
              className="shrink-0 rounded-2xl bg-amber-400 px-5 py-2.5 text-sm font-bold text-black hover:bg-amber-300"
            >
              升级 VIP
            </Link>
          )}
        </div>
      </section>

      {gateOpen && (
        <div
          className="fixed inset-0 z-[210] flex items-center justify-center bg-black/90 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="adult-gate-title"
        >
          <div className="modal-pop w-full max-w-md rounded-3xl border border-red-500/25 bg-[#151116] p-7 shadow-2xl">
            <div className="mb-5 flex items-start justify-between">
              <div>
                <div className="mb-3 inline-flex rounded-2xl bg-red-500/15 px-3 py-1 text-xs font-bold text-red-300">
                  18+ AGE GATE
                </div>
                <h2 id="adult-gate-title" className="text-2xl font-bold">成年内容确认</h2>
              </div>
              <button type="button" onClick={() => setGateOpen(false)} className="text-2xl text-gray-500 hover:text-white">
                &times;
              </button>
            </div>
            <p className="mb-5 text-sm leading-6 text-gray-400">
              成人模式可能展示裸露、性主题或其他仅适合成年人的 AI 内容。请输入出生日期完成年龄验证。
            </p>
            <label className="text-sm text-gray-300">
              出生日期
              <input
                type="date"
                value={birthDate}
                onChange={(event) => setBirthDate(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 outline-none focus:border-red-400/60"
              />
            </label>
            <label className="mt-4 flex cursor-pointer items-start gap-3 text-xs leading-5 text-gray-400">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                className="mt-1 h-4 w-4 accent-red-500"
              />
              <span>我确认本人已满 18 岁，并同意仅在私密、合法且不侵害他人权利的情况下使用成人模式。</span>
            </label>
            <button
              type="button"
              disabled={!birthDate || !confirmed || busy}
              onClick={() => void enable()}
              className="mt-6 w-full rounded-2xl bg-red-500 py-3 font-bold text-white hover:bg-red-400 disabled:opacity-40"
            >
              {busy ? "验证中…" : "确认已满 18 岁并开启"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
