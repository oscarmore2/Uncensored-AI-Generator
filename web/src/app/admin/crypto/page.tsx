"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";

interface CryptoOrder {
  id: number;
  order_id: string;
  user_id: number;
  username: string;
  credits: number;
  amount_usd_cents: number;
  status: string;
  credited: boolean;
  txid: string | null;
  network: string | null;
  payer_currency: string | null;
  created_at: string;
  updated_at: string;
}

interface ListResp {
  total: number;
  page: number;
  limit: number;
  payments: CryptoOrder[];
}

const STATUS_COLORS: Record<string, string> = {
  paid: "bg-emerald-500/15 text-emerald-300",
  paid_over: "bg-emerald-500/15 text-emerald-300",
  wrong_amount: "bg-red-500/15 text-red-300",
  cancel: "bg-gray-500/20 text-gray-400",
  fail: "bg-red-500/15 text-red-300",
  create_failed: "bg-red-500/15 text-red-300",
};

export default function AdminCryptoPage() {
  const [credited, setCredited] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResp | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const c = params.get("credited");
    if (c) setCredited(c);
  }, []);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), limit: "30" });
    if (credited) params.set("credited", credited);
    try {
      setData(await api<ListResp>(`/api/admin/crypto-payments?${params}`));
      setError("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "加载失败");
    }
  }, [page, credited]);

  useEffect(() => {
    void load();
  }, [load]);

  async function manualCredit(p: CryptoOrder) {
    const override = window.prompt(
      `确认人工入账订单 ${p.order_id.slice(0, 16)}…？\n默认点数 ${p.credits}。如需覆盖请输入新点数（留空=默认）：`,
      ""
    );
    if (override === null) return;
    const credits_override = override.trim() ? Number(override) : undefined;
    if (credits_override !== undefined && (!Number.isInteger(credits_override) || credits_override <= 0)) {
      setMsg("点数必须为正整数");
      return;
    }
    const note = window.prompt("备注（可选）：", "") ?? undefined;
    if (!window.confirm(`确定为用户 #${p.user_id} 入账 ${credits_override ?? p.credits} 点？`)) return;

    setBusy(p.id);
    setMsg("");
    try {
      await api(`/api/admin/crypto-payments/${p.id}/credit`, {
        method: "PATCH",
        body: JSON.stringify({ credits_override, note: note || undefined }),
      });
      setMsg(`订单 #${p.id} 已入账`);
      await load();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "入账失败");
    } finally {
      setBusy(null);
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tighter mb-1">加密订单</h1>
      <p className="text-gray-400 text-sm mb-6">Cryptomus 支付订单 · 排查未到账 / wrong_amount · 支持人工入账</p>

      <div className="flex gap-3 mb-5">
        <select
          value={credited}
          onChange={(e) => {
            setCredited(e.target.value);
            setPage(1);
          }}
          className="bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm"
        >
          <option value="">全部</option>
          <option value="1">已入账</option>
          <option value="0">未入账</option>
        </select>
      </div>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}
      {msg && <p className="mb-4 text-sm text-amber-300">{msg}</p>}

      <div className="glass rounded-3xl overflow-x-auto">
        <table className="w-full text-sm min-w-[980px]">
          <thead>
            <tr className="text-left text-xs text-gray-400 border-b border-white/10">
              <th className="px-4 py-3">订单号</th>
              <th className="px-4 py-3">用户</th>
              <th className="px-4 py-3">点数</th>
              <th className="px-4 py-3">金额</th>
              <th className="px-4 py-3">状态</th>
              <th className="px-4 py-3">入账</th>
              <th className="px-4 py-3">币种/网络</th>
              <th className="px-4 py-3">TxID</th>
              <th className="px-4 py-3">时间</th>
              <th className="px-4 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {data?.payments.map((p) => (
              <tr key={p.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                <td className="px-4 py-3 font-mono text-xs text-gray-400" title={p.order_id}>
                  {p.order_id.length > 22 ? `${p.order_id.slice(0, 22)}…` : p.order_id}
                </td>
                <td className="px-4 py-3">
                  <Link href={`/admin/users/${p.user_id}`} className="hover:text-rose-300">
                    {p.username}
                  </Link>{" "}
                  <span className="text-gray-500 text-xs">#{p.user_id}</span>
                </td>
                <td className="px-4 py-3 font-mono">{p.credits}</td>
                <td className="px-4 py-3 font-mono text-xs">${(p.amount_usd_cents / 100).toFixed(2)}</td>
                <td className="px-4 py-3">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[p.status] ?? "bg-amber-500/15 text-amber-300"}`}
                  >
                    {p.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {p.credited ? (
                    <i className="fas fa-check text-emerald-400" />
                  ) : (
                    <i className="fas fa-minus text-gray-500" />
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-gray-400">
                  {p.payer_currency ?? "—"}
                  {p.network ? ` / ${p.network}` : ""}
                </td>
                <td className="px-4 py-3 font-mono text-[10px] text-gray-500" title={p.txid ?? ""}>
                  {p.txid ? `${p.txid.slice(0, 10)}…` : "—"}
                </td>
                <td className="px-4 py-3 text-xs text-gray-500">{new Date(p.created_at).toLocaleString("zh-CN")}</td>
                <td className="px-4 py-3 text-right">
                  {!p.credited && (
                    <button
                      disabled={busy === p.id}
                      onClick={() => void manualCredit(p)}
                      className="text-xs px-3 py-1 bg-emerald-600/20 hover:bg-emerald-600/40 border border-emerald-500/30 text-emerald-300 rounded-lg disabled:opacity-50"
                    >
                      确认入账
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {data && data.payments.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center text-gray-500">
                  暂无加密支付订单
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
