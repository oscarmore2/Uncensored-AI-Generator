"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";

interface AuditLog {
  id: number;
  admin_id: number;
  admin_username: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
}

interface ListResp {
  total: number;
  page: number;
  limit: number;
  logs: AuditLog[];
}

const ACTION_LABELS: Record<string, string> = {
  crypto_manual_credit: "加密人工入账",
  user_vip: "VIP 管理",
  user_balance: "余额调整",
  user_role: "角色变更",
  user_disable: "封禁/解封",
  mod_grant: "授予审核员",
  mod_toggle: "审核员启停",
};

export default function AdminAuditPage() {
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResp | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), limit: "30" });
    if (action) params.set("action", action);
    try {
      setData(await api<ListResp>(`/api/admin/audit-logs?${params}`));
      setError("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "加载失败");
    }
  }, [page, action]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tighter mb-1">审计日志</h1>
      <p className="text-gray-400 text-sm mb-6">管理端敏感操作记录</p>

      <select
        value={action}
        onChange={(e) => {
          setAction(e.target.value);
          setPage(1);
        }}
        className="mb-5 bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm"
      >
        <option value="">全部操作</option>
        {Object.entries(ACTION_LABELS).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      <div className="glass rounded-3xl overflow-x-auto">
        <table className="w-full text-sm min-w-[800px]">
          <thead>
            <tr className="text-left text-xs text-gray-400 border-b border-white/10">
              <th className="px-4 py-3">时间</th>
              <th className="px-4 py-3">管理员</th>
              <th className="px-4 py-3">操作</th>
              <th className="px-4 py-3">目标</th>
              <th className="px-4 py-3">详情</th>
            </tr>
          </thead>
          <tbody>
            {data?.logs.map((l) => (
              <tr key={l.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                <td className="px-4 py-3 text-xs text-gray-500">{new Date(l.created_at).toLocaleString("zh-CN")}</td>
                <td className="px-4 py-3">{l.admin_username}</td>
                <td className="px-4 py-3">
                  <span className="text-xs px-2 py-0.5 bg-rose-500/15 text-rose-300 rounded-full">
                    {ACTION_LABELS[l.action] ?? l.action}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-gray-400">
                  {l.target_type ? `${l.target_type}:${l.target_id}` : "—"}
                </td>
                <td className="px-4 py-3 text-xs font-mono text-gray-500 max-w-xs truncate">
                  {l.detail ? JSON.stringify(l.detail) : "—"}
                </td>
              </tr>
            ))}
            {data && data.logs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-gray-500">
                  暂无审计记录
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
