"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";

interface WebhookLog {
  id: number;
  provider: string;
  event_type: string | null;
  external_id: string | null;
  status: string;
  detail: string | null;
  created_at: string;
}

interface ListResp {
  total: number;
  page: number;
  limit: number;
  logs: WebhookLog[];
}

const STATUS_COLORS: Record<string, string> = {
  ok: "bg-emerald-500/15 text-emerald-300",
  ignored: "bg-gray-500/20 text-gray-400",
  error: "bg-red-500/15 text-red-300",
};

export default function AdminWebhooksPage() {
  const [provider, setProvider] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResp | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), limit: "30" });
    if (provider) params.set("provider", provider);
    try {
      setData(await api<ListResp>(`/api/admin/webhook-logs?${params}`));
      setError("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "加载失败");
    }
  }, [page, provider]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tighter mb-1">Webhook 日志</h1>
      <p className="text-gray-400 text-sm mb-6">Stripe / Cryptomus 回调事件追踪</p>

      <select
        value={provider}
        onChange={(e) => {
          setProvider(e.target.value);
          setPage(1);
        }}
        className="mb-5 bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm"
      >
        <option value="">全部</option>
        <option value="stripe">Stripe</option>
        <option value="cryptomus">Cryptomus</option>
      </select>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      <div className="glass rounded-3xl overflow-x-auto">
        <table className="w-full text-sm min-w-[800px]">
          <thead>
            <tr className="text-left text-xs text-gray-400 border-b border-white/10">
              <th className="px-4 py-3">时间</th>
              <th className="px-4 py-3">来源</th>
              <th className="px-4 py-3">事件</th>
              <th className="px-4 py-3">外部 ID</th>
              <th className="px-4 py-3">状态</th>
              <th className="px-4 py-3">详情</th>
            </tr>
          </thead>
          <tbody>
            {data?.logs.map((l) => (
              <tr key={l.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                <td className="px-4 py-3 text-xs text-gray-500">{new Date(l.created_at).toLocaleString("zh-CN")}</td>
                <td className="px-4 py-3">{l.provider}</td>
                <td className="px-4 py-3 text-xs">{l.event_type ?? "—"}</td>
                <td className="px-4 py-3 font-mono text-xs text-gray-400">{l.external_id ?? "—"}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[l.status] ?? "bg-white/10"}`}>
                    {l.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs font-mono text-gray-500 max-w-xs truncate" title={l.detail ?? ""}>
                  {l.detail ?? "—"}
                </td>
              </tr>
            ))}
            {data && data.logs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-gray-500">
                  暂无 Webhook 记录
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
