"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";

interface AdminUser {
  id: number;
  username: string;
  role: string;
  balance: number;
  is_vip: boolean;
  disabled_at: string | null;
  created_at: string;
  generation_count: number;
  total_recharge_cents: number;
}

interface ListResp {
  total: number;
  page: number;
  limit: number;
  users: AdminUser[];
}

const ROLES = ["user", "moderator", "admin"] as const;

export default function AdminUsersPage() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResp | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), limit: "30" });
    if (q.trim()) params.set("q", q.trim());
    try {
      setData(await api<ListResp>(`/api/admin/users?${params}`));
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "加载失败");
    }
  }, [page, q]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 300);
    return () => clearTimeout(t);
  }, [load]);

  async function patch(userId: number, body: Record<string, unknown>, okMsg: string) {
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

  function adjustBalance(u: AdminUser) {
    const input = window.prompt(`调整「${u.username}」余额（当前 ${u.balance} 点）。输入差额，可为负数：`, "0");
    if (input === null) return;
    const delta = Number(input);
    if (!Number.isInteger(delta) || delta === 0) {
      setMsg("请输入非零整数");
      return;
    }
    void patch(u.id, { balance_delta: delta }, `已调整 ${u.username} 余额 ${delta > 0 ? "+" : ""}${delta}`);
  }

  function toggleDisabled(u: AdminUser) {
    const action = u.disabled_at ? "解封" : "封禁";
    if (!window.confirm(`确定${action}用户「${u.username}」？${u.disabled_at ? "" : "封禁后立即无法登录和调用 API。"}`)) return;
    void patch(u.id, { disabled: !u.disabled_at }, `已${action} ${u.username}`);
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tighter mb-1">用户管理</h1>
      <p className="text-gray-400 text-sm mb-6">改角色 / 调余额 / 封禁解封</p>

      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setPage(1);
        }}
        placeholder="搜索用户名..."
        className="w-full max-w-sm mb-5 bg-[#111] border border-white/10 focus:border-rose-500/60 rounded-2xl px-4 py-2.5 text-sm outline-none"
      />

      {msg && <p className="mb-4 text-sm text-amber-300">{msg}</p>}

      <div className="glass rounded-3xl overflow-x-auto">
        <table className="w-full text-sm min-w-[820px]">
          <thead>
            <tr className="text-left text-xs text-gray-400 border-b border-white/10">
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3">用户名</th>
              <th className="px-4 py-3">角色</th>
              <th className="px-4 py-3">余额</th>
              <th className="px-4 py-3">累计充值</th>
              <th className="px-4 py-3">作品</th>
              <th className="px-4 py-3">状态</th>
              <th className="px-4 py-3">注册时间</th>
              <th className="px-4 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {data?.users.map((u) => (
              <tr key={u.id} className={`border-b border-white/5 hover:bg-white/[0.02] ${u.disabled_at ? "opacity-60" : ""}`}>
                <td className="px-4 py-3 font-mono text-gray-400">#{u.id}</td>
                <td className="px-4 py-3 font-medium">
                  <Link href={`/admin/users/${u.id}`} className="hover:text-rose-300">
                    {u.username}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <select
                    value={u.role}
                    disabled={busy}
                    onChange={(e) => void patch(u.id, { role: e.target.value }, `${u.username} 角色改为 ${e.target.value}`)}
                    className="bg-[#111] border border-white/10 rounded-lg px-2 py-1 text-xs"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3 font-mono">{u.balance}</td>
                <td className="px-4 py-3 font-mono text-xs">${(u.total_recharge_cents / 100).toFixed(2)}</td>
                <td className="px-4 py-3 font-mono">{u.generation_count}</td>
                <td className="px-4 py-3">
                  {u.disabled_at ? (
                    <span className="text-xs px-2 py-0.5 bg-red-500/15 text-red-300 rounded-full">已封禁</span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 bg-emerald-500/15 text-emerald-300 rounded-full">正常</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-gray-500">{new Date(u.created_at).toLocaleDateString("zh-CN")}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button
                    onClick={() => adjustBalance(u)}
                    disabled={busy}
                    className="text-xs px-3 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg mr-2 disabled:opacity-50"
                  >
                    调余额
                  </button>
                  <button
                    onClick={() => toggleDisabled(u)}
                    disabled={busy}
                    className={`text-xs px-3 py-1 border rounded-lg disabled:opacity-50 ${
                      u.disabled_at
                        ? "bg-emerald-600/20 hover:bg-emerald-600/40 border-emerald-500/30 text-emerald-300"
                        : "bg-red-600/20 hover:bg-red-600/40 border-red-500/30 text-red-300"
                    }`}
                  >
                    {u.disabled_at ? "解封" : "封禁"}
                  </button>
                </td>
              </tr>
            ))}
            {data && data.users.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-gray-500">
                  没有匹配的用户
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
