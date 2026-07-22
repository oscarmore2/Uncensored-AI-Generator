"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, ApiError } from "@/lib/client";

interface UserDetail {
  user: {
    id: number;
    username: string;
    role: string;
    balance: number;
    is_vip: boolean;
    vip_expires_at: string | null;
    disabled_at: string | null;
    created_at: string;
    generation_count: number;
    total_recharge_cents: number;
    total_recharge_credits: number;
  };
  recent_transactions: {
    id: number;
    type: string;
    amount: number;
    price_cents: number | null;
    method: string | null;
    created_at: string;
  }[];
  recent_generations: {
    id: number;
    mode: string;
    status: string;
    cost: number;
    created_at: string;
  }[];
  recent_crypto_payments: {
    id: number;
    order_id: string;
    credits: number;
    amount_usd_cents: number;
    status: string;
    credited: boolean;
    created_at: string;
  }[];
}

const ROLES = ["user", "moderator", "admin"] as const;

export default function AdminUserDetailPage() {
  const params = useParams();
  const userId = Number(params.id);
  const [data, setData] = useState<UserDetail | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isInteger(userId)) return;
    try {
      setData(await api<UserDetail>(`/api/admin/users/${userId}`));
      setError("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "加载失败");
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(body: Record<string, unknown>, okMsg: string) {
    if (busy) return;
    setBusy(true);
    setMsg("");
    try {
      await api(`/api/admin/users/${userId}`, { method: "PATCH", body: JSON.stringify(body) });
      setMsg(okMsg);
      await load();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="text-red-400">{error}</p>;
  if (!data) return <p className="text-gray-500">加载中...</p>;

  const u = data.user;

  return (
    <div>
      <Link href="/admin/users" className="text-xs text-gray-400 hover:text-white mb-4 inline-block">
        ← 返回用户列表
      </Link>
      <h1 className="text-3xl font-bold tracking-tighter mb-1">{u.username}</h1>
      <p className="text-gray-400 text-sm mb-6">
        用户 #{u.id} · 注册于 {new Date(u.created_at).toLocaleString("zh-CN")}
      </p>

      {msg && <p className="mb-4 text-sm text-amber-300">{msg}</p>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="glass rounded-3xl p-5">
          <div className="text-2xl font-bold font-mono">{u.balance}</div>
          <div className="text-xs text-gray-400">余额（点）</div>
        </div>
        <div className="glass rounded-3xl p-5">
          <div className="text-2xl font-bold font-mono">${(u.total_recharge_cents / 100).toFixed(2)}</div>
          <div className="text-xs text-gray-400">累计充值</div>
        </div>
        <div className="glass rounded-3xl p-5">
          <div className="text-2xl font-bold font-mono">{u.generation_count}</div>
          <div className="text-xs text-gray-400">生成任务</div>
        </div>
        <div className="glass rounded-3xl p-5">
          <div className="text-lg font-bold">
            {u.is_vip ? (
              <span className="text-purple-300">VIP</span>
            ) : (
              <span className="text-gray-500">普通</span>
            )}
          </div>
          <div className="text-xs text-gray-400">
            {u.vip_expires_at ? `到期 ${new Date(u.vip_expires_at).toLocaleDateString("zh-CN")}` : "无 VIP"}
          </div>
        </div>
      </div>

      <div className="glass rounded-3xl p-5 mb-8">
        <div className="text-sm font-semibold mb-4">管理操作</div>
        <div className="flex flex-wrap gap-3">
          <select
            value={u.role}
            disabled={busy}
            onChange={(e) => void patch({ role: e.target.value }, `角色已改为 ${e.target.value}`)}
            className="bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button
            disabled={busy}
            onClick={() => {
              const input = window.prompt("余额调整差额（整数，可为负）：", "0");
              if (input === null) return;
              const delta = Number(input);
              if (!Number.isInteger(delta) || delta === 0) return;
              void patch({ balance_delta: delta }, `余额已调整 ${delta > 0 ? "+" : ""}${delta}`);
            }}
            className="text-sm px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl disabled:opacity-50"
          >
            调余额
          </button>
          <button
            disabled={busy}
            onClick={() => {
              if (u.is_vip) {
                if (!window.confirm("撤销该用户 VIP？")) return;
                void patch({ is_vip: false }, "已撤销 VIP");
              } else {
                const days = window.prompt("授予 VIP 天数（默认 30）：", "30");
                if (days === null) return;
                const d = Number(days) || 30;
                const expires = new Date(Date.now() + d * 24 * 60 * 60 * 1000).toISOString();
                void patch({ is_vip: true, vip_expires_at: expires }, `已授予 VIP ${d} 天`);
              }
            }}
            className="text-sm px-4 py-2 bg-purple-600/20 hover:bg-purple-600/40 border border-purple-500/30 text-purple-300 rounded-xl disabled:opacity-50"
          >
            {u.is_vip ? "撤销 VIP" : "授予 VIP"}
          </button>
          <button
            disabled={busy}
            onClick={() => {
              const action = u.disabled_at ? "解封" : "封禁";
              if (!window.confirm(`确定${action}该用户？`)) return;
              void patch({ disabled: !u.disabled_at }, `已${action}`);
            }}
            className={`text-sm px-4 py-2 border rounded-xl disabled:opacity-50 ${
              u.disabled_at
                ? "bg-emerald-600/20 border-emerald-500/30 text-emerald-300"
                : "bg-red-600/20 border-red-500/30 text-red-300"
            }`}
          >
            {u.disabled_at ? "解封" : "封禁"}
          </button>
          <Link
            href={`/admin/transactions?user_id=${u.id}`}
            className="text-sm px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl"
          >
            查看流水
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
        <div className="glass rounded-3xl p-5">
          <div className="text-sm font-semibold mb-3">最近流水</div>
          <div className="space-y-2 text-xs">
            {data.recent_transactions.map((t) => (
              <div key={t.id} className="flex justify-between border-b border-white/5 pb-2">
                <span>
                  {t.type} · {t.method ?? "—"}
                </span>
                <span className="font-mono">
                  {t.amount > 0 ? "+" : ""}
                  {t.amount}
                  {t.price_cents ? ` · $${(t.price_cents / 100).toFixed(2)}` : ""}
                </span>
              </div>
            ))}
            {data.recent_transactions.length === 0 && <p className="text-gray-500">暂无流水</p>}
          </div>
        </div>
        <div className="glass rounded-3xl p-5">
          <div className="text-sm font-semibold mb-3">最近生成</div>
          <div className="space-y-2 text-xs">
            {data.recent_generations.map((g) => (
              <div key={g.id} className="flex justify-between border-b border-white/5 pb-2">
                <span>
                  #{g.id} · {g.mode} · {g.status}
                </span>
                <span className="font-mono text-gray-400">{g.cost} 点</span>
              </div>
            ))}
            {data.recent_generations.length === 0 && <p className="text-gray-500">暂无生成</p>}
          </div>
        </div>
      </div>

      <div className="glass rounded-3xl p-5">
        <div className="text-sm font-semibold mb-3">加密订单</div>
        <div className="space-y-2 text-xs">
          {data.recent_crypto_payments.map((p) => (
            <div key={p.id} className="flex justify-between border-b border-white/5 pb-2">
              <span>
                {p.order_id.slice(0, 20)}… · {p.status} · {p.credited ? "已入账" : "未入账"}
              </span>
              <span className="font-mono">${(p.amount_usd_cents / 100).toFixed(2)}</span>
            </div>
          ))}
          {data.recent_crypto_payments.length === 0 && <p className="text-gray-500">暂无加密订单</p>}
        </div>
      </div>
    </div>
  );
}
