"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";

interface ModGeneration {
  id: number;
  mode: string;
  prompt: string;
  status: string;
  result_urls: string[] | null;
  visibility: string;
  deleted_at: string | null;
  created_at: string;
}

interface Resp {
  user: { id: number; username: string; balance: number; role: string };
  total: number;
  page: number;
  limit: number;
  generations: ModGeneration[];
}

export default function ModUserGenerationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Resp | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api<Resp>(`/api/mod/users/${id}/generations?page=${page}&limit=30`));
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "加载失败");
    }
  }, [id, page]);

  useEffect(() => {
    void load();
  }, [load]);

  async function action(fn: () => Promise<unknown>, okMsg: string) {
    if (busy) return;
    setBusy(true);
    setMsg("");
    try {
      await fn();
      setMsg(okMsg);
      await load();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <div>
      <Link href="/mod/users" className="text-sm text-gray-400 hover:text-white">
        <i className="fas fa-arrow-left mr-2" />
        返回用户列表
      </Link>

      <div className="mt-4 mb-6">
        <h1 className="text-3xl font-bold tracking-tighter">
          {data?.user.username ?? `用户 #${id}`}
          {data && <span className="ml-3 text-sm font-normal text-gray-400">余额 {data.user.balance} 点 · 共 {data.total} 件作品</span>}
        </h1>
      </div>

      {msg && <p className="mb-4 text-sm text-amber-300">{msg}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {data?.generations.map((g) => (
          <div key={g.id} className={`glass rounded-3xl overflow-hidden ${g.deleted_at ? "opacity-60" : ""}`}>
            <div className="relative aspect-video bg-[#111]">
              {g.result_urls?.[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={g.result_urls[0]} alt={`#${g.id}`} className="w-full h-full object-cover" loading="lazy" />
              ) : (
                <div className="fake-image w-full h-full flex items-center justify-center text-xs text-gray-500">
                  无结果图（{g.status}）
                </div>
              )}
              <div className="absolute top-3 right-3 flex gap-1">
                {g.deleted_at && <span className="text-[10px] px-2 py-0.5 bg-red-600/80 rounded-full">已删</span>}
                {g.visibility === "featured" && (
                  <span className="text-[10px] px-2 py-0.5 bg-emerald-600/80 rounded-full">已曝光</span>
                )}
              </div>
            </div>
            <div className="p-4">
              <div className="text-xs text-gray-400 font-mono mb-2">
                #{g.id} · {g.mode} · {g.status}
              </div>
              <p className="text-xs text-gray-300 line-clamp-2 mb-3">{g.prompt}</p>
              <div className="flex gap-2">
                {g.deleted_at ? (
                  <button
                    onClick={() => action(() => api(`/api/mod/generations/${g.id}/restore`, { method: "POST" }), `#${g.id} 已恢复`)}
                    disabled={busy}
                    className="flex-1 py-1.5 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl disabled:opacity-50"
                  >
                    恢复
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() =>
                        action(() => api(`/api/mod/generations/${g.id}/soft-delete`, { method: "POST" }), `#${g.id} 已软删除`)
                      }
                      disabled={busy}
                      className="flex-1 py-1.5 text-xs bg-white/5 hover:bg-red-600/30 border border-white/10 rounded-xl disabled:opacity-50"
                    >
                      软删除
                    </button>
                    {g.status === "succeeded" && g.visibility !== "featured" && (
                      <button
                        onClick={() =>
                          action(() => api(`/api/mod/generations/${g.id}/feature`, { method: "POST" }), `#${g.id} 已曝光`)
                        }
                        disabled={busy}
                        className="flex-1 py-1.5 text-xs bg-emerald-600/20 hover:bg-emerald-600/40 border border-emerald-500/30 text-emerald-300 rounded-xl disabled:opacity-50"
                      >
                        曝光
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {data && data.generations.length === 0 && (
        <div className="glass rounded-3xl p-16 text-center text-gray-500">该用户暂无作品</div>
      )}

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
