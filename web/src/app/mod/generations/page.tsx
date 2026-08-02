"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/client";
import { MediaKindBadge, MediaPreviewModal, MediaThumb } from "@/components/MediaPreview";

interface ModGeneration {
  id: number;
  user_id: number;
  username?: string;
  mode: string;
  prompt: string;
  status: string;
  result_urls: string[] | null;
  visibility: string;
  deleted_at: string | null;
  created_at: string;
  is_adult: boolean;
}

interface ListResp {
  total: number;
  page: number;
  limit: number;
  generations: ModGeneration[];
}

function GenerationsInner() {
  const sp = useSearchParams();
  const [status, setStatus] = useState(sp.get("status") ?? "");
  const [includeDeleted, setIncludeDeleted] = useState(sp.get("deleted") === "1");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResp | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [preview, setPreview] = useState<ModGeneration | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), limit: "30" });
    if (status) params.set("status", status);
    if (includeDeleted) params.set("include_deleted", "1");
    try {
      setData(await api<ListResp>(`/api/mod/generations?${params}`));
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "加载失败");
    }
  }, [page, status, includeDeleted]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function action(fn: () => Promise<unknown>, okMsg: string) {
    if (busy) return;
    setBusy(true);
    setMsg("");
    try {
      await fn();
      setMsg(okMsg);
      setSelected(new Set());
      await load();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  const softDelete = (id: number) =>
    action(() => api(`/api/mod/generations/${id}/soft-delete`, { method: "POST" }), `#${id} 已软删除`);
  const restore = (id: number) =>
    action(() => api(`/api/mod/generations/${id}/restore`, { method: "POST" }), `#${id} 已恢复`);
  const feature = (id: number) =>
    action(() => api(`/api/mod/generations/${id}/feature`, { method: "POST" }), `#${id} 已曝光到公共库`);
  const bulkDelete = () =>
    action(
      () =>
        api("/api/mod/generations/bulk-soft-delete", {
          method: "POST",
          body: JSON.stringify({ ids: Array.from(selected) }),
        }),
      `已批量软删除 ${selected.size} 项`
    );

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tighter mb-1">作品审核</h1>
      <p className="text-ink-muted text-sm mb-6">软删除 / 恢复 / 曝光到公共库；点击作品可预览图片、视频与 3D 模型</p>

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="bg-surface border border-line rounded-xl px-3 py-2 text-sm"
        >
          <option value="">全部状态</option>
          <option value="succeeded">succeeded</option>
          <option value="processing">processing</option>
          <option value="failed">failed</option>
        </select>
        <label className="flex items-center gap-x-2 text-sm text-ink-muted cursor-pointer">
          <input
            type="checkbox"
            checked={includeDeleted}
            onChange={(e) => {
              setIncludeDeleted(e.target.checked);
              setPage(1);
            }}
          />
          <span>包含已删除</span>
        </label>

        {selected.size > 0 && (
          <button
            onClick={bulkDelete}
            disabled={busy}
            className="ml-auto px-4 py-2 text-sm font-semibold bg-red-600/80 hover:bg-red-600 rounded-2xl disabled:opacity-50"
          >
            <i className="fas fa-trash mr-1" /> 批量软删除（{selected.size}）
          </button>
        )}
      </div>

      {msg && <p className="mb-4 text-sm text-amber-800">{msg}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {data?.generations.map((g) => (
          (() => {
            const featureDeadline = new Date(g.created_at).getTime() + 7 * 24 * 60 * 60 * 1000;
            const featureExpired = Date.now() >= featureDeadline;
            return (
          <div
            key={g.id}
            className={`glass rounded-3xl overflow-hidden ${g.deleted_at ? "opacity-60" : ""} ${
              selected.has(g.id) ? "ring-2 ring-orange-500" : ""
            }`}
          >
            <div className="relative aspect-video bg-surface">
              {g.result_urls?.length ? (
                <button
                  type="button"
                  onClick={() => setPreview(g)}
                  title="点击预览"
                  className="absolute inset-0 w-full h-full group cursor-zoom-in"
                >
                  <MediaThumb urls={g.result_urls} mode={g.mode} alt={`#${g.id}`} />
                  <span className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-colors" />
                </button>
              ) : (
                <div className="fake-image w-full h-full flex items-center justify-center text-xs text-ink-subtle">
                  无结果图（{g.status}）
                </div>
              )}
              <label className="absolute top-3 left-3 z-10 w-6 h-6 flex items-center justify-center bg-black/70 rounded-lg cursor-pointer text-white">
                <input type="checkbox" checked={selected.has(g.id)} onChange={() => toggle(g.id)} />
              </label>
              <div className="absolute top-3 right-3 z-10 flex gap-1 pointer-events-none">
                <MediaKindBadge urls={g.result_urls} mode={g.mode} />
                {g.deleted_at && <span className="text-[10px] px-2 py-0.5 bg-red-600/80 rounded-full">已删</span>}
                {g.visibility === "featured" && (
                  <span className="text-[10px] px-2 py-0.5 bg-emerald-600/80 rounded-full">已曝光</span>
                )}
                {g.is_adult && (
                  <span className="text-[10px] px-2 py-0.5 bg-red-600 rounded-full font-bold">18+</span>
                )}
              </div>
            </div>
            <div className="p-4">
              <div className="flex items-center justify-between text-xs text-ink-muted mb-2">
                <span className="font-mono">
                  #{g.id} · {g.mode} · {g.status}
                </span>
                <span>{g.username}</span>
              </div>
              <p className="text-xs text-ink-muted line-clamp-2 mb-3">{g.prompt}</p>
              {g.visibility !== "featured" && (
                <p className={`text-[11px] mb-3 ${featureExpired ? "text-red-700" : "text-amber-800"}`}>
                  <i className="fas fa-hourglass-half mr-1" />
                  {featureExpired
                    ? "已超过 7 天，无法精选"
                    : `精选截止：${new Date(featureDeadline).toLocaleString()}`}
                </p>
              )}
              <div className="flex gap-2">
                {g.deleted_at ? (
                  <button
                    onClick={() => restore(g.id)}
                    disabled={busy}
                    className="flex-1 py-1.5 text-xs bg-black/[0.03] hover:bg-black/[0.06] border border-line rounded-xl disabled:opacity-50"
                  >
                    恢复
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => softDelete(g.id)}
                      disabled={busy}
                      className="flex-1 py-1.5 text-xs bg-black/[0.03] hover:bg-red-600/30 border border-line rounded-xl disabled:opacity-50"
                    >
                      软删除
                    </button>
                    {g.status === "succeeded" && g.visibility !== "featured" && (
                      <button
                        onClick={() => feature(g.id)}
                        disabled={busy || featureExpired}
                        title={featureExpired ? "作品生成已超过 7 天" : "设为精选"}
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
            );
          })()
        ))}
      </div>

      {data && data.generations.length === 0 && (
        <div className="glass rounded-3xl p-16 text-center text-ink-subtle">没有符合条件的作品</div>
      )}

      {totalPages > 1 && (
        <div className="mt-8 flex justify-center gap-x-3 text-sm">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="px-5 py-2 border border-line rounded-2xl hover:bg-black/[0.04] disabled:opacity-40"
          >
            上一页
          </button>
          <span className="px-4 py-2 text-ink-muted">
            {page} / {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="px-5 py-2 border border-line rounded-2xl hover:bg-black/[0.04] disabled:opacity-40"
          >
            下一页
          </button>
        </div>
      )}

      {preview && (
        <MediaPreviewModal
          urls={preview.result_urls ?? []}
          mode={preview.mode}
          onClose={() => setPreview(null)}
          title={
            <>
              <span className="font-mono text-ink-muted">#{preview.id}</span>
              <span className="text-ink-subtle">{preview.mode}</span>
              {preview.is_adult && (
                <span className="px-1.5 py-0.5 rounded bg-red-600 text-[10px] font-bold">18+</span>
              )}
              {preview.deleted_at && (
                <span className="px-1.5 py-0.5 rounded bg-red-600/80 text-[10px]">已删</span>
              )}
              {preview.visibility === "featured" && (
                <span className="px-1.5 py-0.5 rounded bg-emerald-600/80 text-[10px]">已曝光</span>
              )}
            </>
          }
        >
          <div className="space-y-3">
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-muted">
              <span>用户：{preview.username ?? `ID ${preview.user_id}`}</span>
              <span>状态：{preview.status}</span>
              <span>生成于：{new Date(preview.created_at).toLocaleString()}</span>
            </div>
            <div>
              <div className="text-[11px] text-ink-subtle mb-1">提示词</div>
              <p className="text-sm text-ink whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
                {preview.prompt || "（空）"}
              </p>
            </div>
            <div className="flex gap-2 pt-1">
              {preview.deleted_at ? (
                <button
                  onClick={() => {
                    void restore(preview.id);
                    setPreview(null);
                  }}
                  disabled={busy}
                  className="flex-1 py-2 text-xs bg-black/[0.03] hover:bg-black/[0.06] border border-line rounded-xl disabled:opacity-50"
                >
                  恢复
                </button>
              ) : (
                <>
                  <button
                    onClick={() => {
                      void softDelete(preview.id);
                      setPreview(null);
                    }}
                    disabled={busy}
                    className="flex-1 py-2 text-xs bg-black/[0.03] hover:bg-red-600/30 border border-line rounded-xl disabled:opacity-50"
                  >
                    软删除
                  </button>
                  {preview.status === "succeeded" && preview.visibility !== "featured" && (
                    <button
                      onClick={() => {
                        void feature(preview.id);
                        setPreview(null);
                      }}
                      disabled={
                        busy ||
                        Date.now() >=
                          new Date(preview.created_at).getTime() + 7 * 24 * 60 * 60 * 1000
                      }
                      className="flex-1 py-2 text-xs bg-emerald-600/20 hover:bg-emerald-600/40 border border-emerald-500/30 text-emerald-300 rounded-xl disabled:opacity-50"
                    >
                      曝光到公共库
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </MediaPreviewModal>
      )}
    </div>
  );
}

export default function ModGenerationsPage() {
  return (
    <Suspense>
      <GenerationsInner />
    </Suspense>
  );
}
