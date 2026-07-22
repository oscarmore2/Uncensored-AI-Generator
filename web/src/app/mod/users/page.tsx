"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";

interface ModUser {
  id: number;
  username: string;
  role: string;
  balance: number;
  is_vip: boolean;
  created_at: string;
  generation_count: number;
}

interface ListResp {
  total: number;
  page: number;
  limit: number;
  users: ModUser[];
}

export default function ModUsersPage() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResp | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), limit: "30" });
    if (q.trim()) params.set("q", q.trim());
    try {
      setData(await api<ListResp>(`/api/mod/users?${params}`));
      setError("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "加载失败");
    }
  }, [page, q]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 300);
    return () => clearTimeout(t);
  }, [load]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tighter mb-1">用户作品</h1>
      <p className="text-gray-400 text-sm mb-6">按用户查看与管理生成内容</p>

      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setPage(1);
        }}
        placeholder="搜索用户名..."
        className="w-full max-w-sm mb-5 bg-[#111] border border-white/10 focus:border-rose-500/60 rounded-2xl px-4 py-2.5 text-sm outline-none"
      />

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      <div className="glass rounded-3xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-400 border-b border-white/10">
              <th className="px-5 py-3">ID</th>
              <th className="px-5 py-3">用户名</th>
              <th className="px-5 py-3">角色</th>
              <th className="px-5 py-3">余额</th>
              <th className="px-5 py-3">作品数</th>
              <th className="px-5 py-3">注册时间</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {data?.users.map((u) => (
              <tr key={u.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                <td className="px-5 py-3 font-mono text-gray-400">#{u.id}</td>
                <td className="px-5 py-3 font-medium">{u.username}</td>
                <td className="px-5 py-3">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      u.role === "admin"
                        ? "bg-rose-500/15 text-rose-300"
                        : u.role === "moderator"
                          ? "bg-amber-500/15 text-amber-300"
                          : "bg-white/10 text-gray-300"
                    }`}
                  >
                    {u.role}
                  </span>
                </td>
                <td className="px-5 py-3 font-mono">{u.balance}</td>
                <td className="px-5 py-3 font-mono">{u.generation_count}</td>
                <td className="px-5 py-3 text-xs text-gray-500">
                  {new Date(u.created_at).toLocaleDateString("zh-CN")}
                </td>
                <td className="px-5 py-3 text-right">
                  <Link href={`/mod/users/${u.id}`} className="text-xs text-rose-400 hover:text-rose-300">
                    查看作品 <i className="fas fa-arrow-right ml-1" />
                  </Link>
                </td>
              </tr>
            ))}
            {data && data.users.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-10 text-center text-gray-500">
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
