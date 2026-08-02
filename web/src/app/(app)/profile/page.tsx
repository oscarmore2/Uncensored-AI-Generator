"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type ApiGeneration } from "@/lib/client";
import { clearAllDrafts } from "@/lib/draft-store";
import { useApp } from "@/components/AppContext";
import { AdultModeSettings } from "@/components/AdultModeSettings";
import { useLocale, useTranslations } from "next-intl";

export default function ProfilePage() {
  const t = useTranslations("Profile");
  const locale = useLocale();
  const router = useRouter();
  const { user, refreshUser, toast } = useApp();
  const [totalGens, setTotalGens] = useState<number | null>(null);

  useEffect(() => {
    void refreshUser();
    api<ApiGeneration[]>("/api/generations")
      .then((gens) => setTotalGens(gens.length))
      .catch(() => setTotalGens(null));
  }, [refreshUser]);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    // 未提交的提示词与参考图不留给下一个登录的人
    await clearAllDrafts().catch(() => {});
    toast(t("loggedOut"));
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-4xl font-bold tracking-tighter mb-8">{t("title")}</h1>

      <div className="glass rounded-3xl p-8 mb-6">
        <div className="flex items-center gap-x-6">
          <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-orange-600 to-amber-800 border-2 border-white/20 flex-shrink-0 flex items-center justify-center text-2xl font-black uppercase">
            {user?.username.slice(0, 2) ?? "?"}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-x-3">
              <h2 className="text-2xl font-bold">{user?.username ?? "—"}</h2>
              {user?.is_vip && (
                <span className="media-badge text-xs px-3 py-0.5">
                  {user.vip_tier?.name ?? "VIP"}
                </span>
              )}
            </div>
            <p className="text-gray-400 text-sm">{t("session")}</p>

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => router.push("/pricing")}
                className="px-5 py-2 text-sm font-semibold bg-white text-black rounded-2xl flex items-center gap-x-2 hover:bg-gray-100"
              >
                <i className="fas fa-wallet" /> <span>{t("buyCredits")}</span>
              </button>
              <button
                onClick={logout}
                className="px-5 py-2 text-sm font-semibold border border-white/20 hover:bg-white/5 rounded-2xl"
              >
                {t("logout")}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="glass rounded-3xl p-5 text-center">
          <div className="text-4xl font-mono font-bold text-orange-400 stat-number">{totalGens ?? "—"}</div>
          <div className="text-xs text-gray-400 mt-1">{t("creations")}</div>
        </div>
        <div className="glass rounded-3xl p-5 text-center">
          <div className="text-4xl font-mono font-bold text-amber-400 stat-number">{user?.balance ?? "—"}</div>
          <div className="text-xs text-gray-400 mt-1">{t("balance")}</div>
        </div>
        <div className="glass rounded-3xl p-5 text-center">
          <div className="text-4xl font-mono font-bold text-emerald-400">
            {user?.is_vip ? user.vip_tier?.name ?? "VIP" : t("standard")}
          </div>
          <div className="text-xs text-gray-400 mt-1">{t("level")}</div>
        </div>
      </div>

      {user?.is_vip && user.vip_expires_at && (
        <div className="glass rounded-3xl p-6">
          <h3 className="font-semibold mb-2 flex items-center">
            <i className="fas fa-crown text-amber-400 mr-2" />{" "}
            {t("validity", { tier: user.vip_tier?.name ?? "VIP" })}
          </h3>
          <p className="text-sm text-gray-400">
            {t("expires", { date: new Date(user.vip_expires_at).toLocaleDateString(locale) })}
            {user.vip_tier && user.vip_tier.discount_percent > 0
              ? ` · ${t("discount", { percent: user.vip_tier.discount_percent })}`
              : ""}
          </p>
        </div>
      )}
      <AdultModeSettings />
    </div>
  );
}
