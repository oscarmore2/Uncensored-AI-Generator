"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";

interface AdminTx {
  id: number;
  user_id: number;
  username: string;
  type: string;
  amount: number;
  price_cents: number | null;
  method: string | null;
  stripe_payment_id: string | null;
  created_at: string;
}

interface ListResp {
  total: number;
  page: number;
  limit: number;
  transactions: AdminTx[];
}

const TYPE_LABELS: Record<string, string> = {
  recharge: "充值",
  refund: "退款",
  vip: "VIP",
  admin_adjust: "管理调整",
};

const TYPE_COLORS: Record<string, string> = {
  recharge: "bg-emerald-500/15 text-emerald-300",
  refund: "bg-amber-500/15 text-amber-300",
  vip: "bg-purple-500/15 text-purple-300",
  admin_adjust: "bg-rose-500/15 text-rose-300",
};

export default function AdminTransactionsPage() {
  const [type, setType] = useState("");
  const [method, setMethod] = useState("");
  const [userId, setUserId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResp | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const uid = params.get("user_id");
    if (uid) setUserId(uid);
  }, []);

  const buildParams = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), limit: "30" });
    if (type) params.set("type", type);
    if (method) params.set("method", method);
    if (userId.trim()) params.set("user_id", userId.trim());
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return params;
  }, [page, type, method, userId, from, to]);

  const load = useCallback(async () => {
    try {
      setData(await api<ListResp>(`/api/admin/transactions?${buildParams()}`));
      setError("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "加载失败");
    }
  }, [buildParams]);

  useEffect(() => {
    void load();
  }, [load]);

  function exportCsv() {
    window.open(`/api/admin/transactions/export?${buildParams()}`, "_blank");
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tighter mb-1">交易流水</h1>
      <p className="text-gray-400 text-sm mb-6">充值 / 退款 / VIP / 管理调整</p>

      <div className="flex flex-wrap gap-3 mb-5">
        <select
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setPage(1);
          }}
          className="bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm"
        >
          <option value="">全部类型</option>
          {Object.entries(TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select
          value={method}
          onChange={(e) => {
            setMethod(e.target.value);
            setPage(1);
          }}
          className="bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm"
        >
          <option value="">全部渠道</option>
          <option value="stripe">Stripe</option>
          <option value="cryptomus">Cryptomus</option>
          <option value="demo">Demo</option>
          <option value="admin">Admin</option>
        </select>
        <input
          value={userId}
          onChange={(e) => {
            setUserId(e.target.value);
            setPage(1);
          }}
          placeholder="用户 ID"
          className="bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm w-28"
        />
        <input
          type="date"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setPage(1);
          }}
          className="bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm"
        />
        <input
          type="date"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setPage(1);
          }}
          className="bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm"
        />
        <button
          onClick={exportCsv}
          className="text-sm px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl"
        >
          导出 CSV
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      <div className="glass rounded-3xl overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="text-left text-xs text-gray-400 border-b border-white/10">
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3">用户</th>
              <th className="px-4 py-3">类型</th>
              <th className="px-4 py-3">点数</th>
              <th className="px-4 py-3">金额</th>
              <th className="px-4 py-3">渠道</th>
              <th className="px-4 py-3">时间</th>
            </tr>
          </thead>
          <tbody>
            {data?.transactions.map((t) => (
              <tr key={t.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                <td className="px-4 py-3 font-mono text-gray-400">#{t.id}</td>
                <td className="px-4 py-3">
                  <Link href={`/admin/users/${t.user_id}`} className="hover:text-rose-300">
                    {t.username}
                  </Link>{" "}
                  <span className="text-gray-500 text-xs">#{t.user_id}</span>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${TYPE_COLORS[t.type] ?? "bg-white/10 text-gray-300"}`}>
                    {TYPE_LABELS[t.type] ?? t.type}
                  </span>
                </td>
                <td className={`px-4 py-3 font-mono ${t.amount < 0 ? "text-red-300" : "text-emerald-300"}`}>
                  {t.amount > 0 ? "+" : ""}
                  {t.amount}
                </td>
                <td className="px-4 py-3 font-mono text-xs">
                  {t.price_cents !== null ? `$${(t.price_cents / 100).toFixed(2)}` : "—"}
                </td>
                <td className="px-4 py-3 text-xs text-gray-400">{t.method ?? "—"}</td>
                <td className="px-4 py-3 text-xs text-gray-500">{new Date(t.created_at).toLocaleString("zh-CN")}</td>
              </tr>
            ))}
            {data && data.transactions.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-gray-500">
                  暂无流水
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-8 flex justify-center gap-x-3 text-sm">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="px-5 py-2 border border-white/10 rounded-2xl hover:bg-white/5 disabled:opacity-40"
          >
            上一页
          </button>
          <span className="px-4 py-2 text-gray-400">
            {page} / {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="px-5 py-2 border border-white/10 rounded-2xl hover:bg-white/5 disabled:opacity-40"
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}
