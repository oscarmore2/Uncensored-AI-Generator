"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type ApiGeneration } from "@/lib/client";
import { useApp } from "@/components/AppContext";
import { AdultModeSettings } from "@/components/AdultModeSettings";

export default function ProfilePage() {
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
    toast("已退出登录");
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-4xl font-bold tracking-tighter mb-8">个人中心</h1>

      <div className="glass rounded-3xl p-8 mb-6">
        <div className="flex items-center gap-x-6">
          <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-rose-700 to-pink-900 border-2 border-white/20 flex-shrink-0 flex items-center justify-center text-2xl font-black uppercase">
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
            <p className="text-gray-400 text-sm">Cookie 会话 • 同源 API</p>

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => router.push("/pricing")}
                className="px-5 py-2 text-sm font-semibold bg-white text-black rounded-2xl flex items-center gap-x-2 hover:bg-gray-100"
              >
                <i className="fas fa-wallet" /> <span>充值点数</span>
              </button>
              <button
                onClick={logout}
                className="px-5 py-2 text-sm font-semibold border border-white/20 hover:bg-white/5 rounded-2xl"
              >
                退出登录
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="glass rounded-3xl p-5 text-center">
          <div className="text-4xl font-mono font-bold text-rose-400 stat-number">{totalGens ?? "—"}</div>
          <div className="text-xs text-gray-400 mt-1">已生成作品</div>
        </div>
        <div className="glass rounded-3xl p-5 text-center">
          <div className="text-4xl font-mono font-bold text-amber-400 stat-number">{user?.balance ?? "—"}</div>
          <div className="text-xs text-gray-400 mt-1">当前点数余额</div>
        </div>
        <div className="glass rounded-3xl p-5 text-center">
          <div className="text-4xl font-mono font-bold text-emerald-400">
            {user?.is_vip ? user.vip_tier?.name ?? "VIP" : "普通"}
          </div>
          <div className="text-xs text-gray-400 mt-1">账户等级</div>
        </div>
      </div>

      {user?.is_vip && user.vip_expires_at && (
        <div className="glass rounded-3xl p-6">
          <h3 className="font-semibold mb-2 flex items-center">
            <i className="fas fa-crown text-amber-400 mr-2" />{" "}
            {user.vip_tier?.name ?? "VIP"} 有效期
          </h3>
          <p className="text-sm text-gray-400">
            到期时间：{new Date(user.vip_expires_at).toLocaleDateString()}
            {user.vip_tier && user.vip_tier.discount_percent > 0
              ? ` · 生成折扣 ${user.vip_tier.discount_percent}%`
              : ""}
          </p>
        </div>
      )}
      <AdultModeSettings />
    </div>
  );
}
