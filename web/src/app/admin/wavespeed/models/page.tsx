"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";

interface ProductInfo {
  id: number;
  label: string;
  credit_cost: number;
  is_active: boolean;
  is_recommended: boolean;
  sort_order: number;
}

interface CatalogModel {
  id: number;
  model_id: string;
  name: string;
  type: string;
  description: string;
  base_price_usd: number;
  last_unit_price_usd: number | null;
  thumbnail_url: string | null;
  synced_at: string;
  product: ProductInfo | null;
}

interface ListResp {
  total: number;
  page: number;
  page_size: number;
  last_synced_at: string | null;
  types: string[];
  models: CatalogModel[];
}

export default function AdminWaveSpeedModelsPage() {
  const [data, setData] = useState<ListResp | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [shelved, setShelved] = useState("");
  const [adult, setAdult] = useState(false);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (type) params.set("type", type);
      if (shelved) params.set("shelved", shelved);
      if (adult) params.set("adult", "1");
      params.set("page", String(page));
      params.set("page_size", "24");
      setData(await api<ListResp>(`/api/admin/wavespeed/models?${params}`));
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "加载失败");
    }
  }, [q, type, shelved, adult, page]);

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

  function patchUrl(modelId: string) {
    return `/api/admin/wavespeed/models/${modelId
      .split("/")
      .map((s) => encodeURIComponent(s))
      .join("/")}`;
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  return (
    <div>
      <div className="flex items-end justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tighter mb-1">玩物模型库</h1>
          <p className="text-gray-400 text-sm">
            同步 WaveSpeed 全库 · 缩略图与调用成本 · 上架 / 推荐 / 本站点数
            {data?.last_synced_at
              ? ` · 上次同步 ${new Date(data.last_synced_at).toLocaleString("zh-CN")}`
              : " · 尚未同步"}
            {data ? ` · 共 ${data.total} 条` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/admin/wavespeed"
            className="px-4 py-2.5 text-sm border border-white/10 rounded-2xl hover:bg-white/5"
          >
            API Key
          </Link>
          <button
            disabled={busy}
            onClick={() =>
              action(
                () => api("/api/admin/wavespeed/models/sync", { method: "POST" }),
                "同步完成"
              )
            }
            className="px-5 py-2.5 text-sm font-semibold bg-rose-600 hover:bg-rose-500 rounded-2xl disabled:opacity-50"
          >
            <i className="fas fa-rotate mr-2" />
            同步全库
          </button>
        </div>
      </div>

      {msg && <p className="mb-4 text-sm text-amber-300">{msg}</p>}

      <div className="flex flex-wrap gap-3 mb-6">
        <input
          value={q}
          onChange={(e) => {
            setPage(1);
            setQ(e.target.value);
          }}
          placeholder="搜索 model_id / 名称"
          className="bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm w-56"
        />
        <select
          value={type}
          onChange={(e) => {
            setPage(1);
            setType(e.target.value);
          }}
          className="bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm"
        >
          <option value="">全部类型</option>
          {(data?.types ?? []).map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          value={shelved}
          onChange={(e) => {
            setPage(1);
            setShelved(e.target.value);
          }}
          className="bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm"
        >
          <option value="">上架状态</option>
          <option value="1">已有 Product</option>
          <option value="0">未上架</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={adult}
            onChange={(e) => {
              setPage(1);
              setAdult(e.target.checked);
            }}
          />
          成人向关键词
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {(data?.models ?? []).map((m) => {
          const p = m.product;
          const active = Boolean(p?.is_active);
          return (
            <div key={m.model_id} className="glass rounded-2xl overflow-hidden flex flex-col">
              <div className="aspect-video bg-[#151515] relative">
                {m.thumbnail_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={m.thumbnail_url}
                    alt=""
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-600 text-3xl font-black">
                    {m.name.slice(0, 1).toUpperCase()}
                  </div>
                )}
                {p?.is_recommended && (
                  <span className="absolute top-2 left-2 text-[10px] px-2 py-0.5 rounded bg-amber-500/90 text-black font-semibold">
                    推荐
                  </span>
                )}
              </div>
              <div className="p-3 flex-1 flex flex-col gap-2">
                <div>
                  <div className="font-medium text-sm line-clamp-1">{p?.label || m.name}</div>
                  <div className="text-[10px] text-gray-500 font-mono line-clamp-1">{m.model_id}</div>
                  <div className="text-xs text-gray-400 mt-1">
                    {m.type || "—"} ·{" "}
                    <span className="text-emerald-300 font-mono">
                      ${m.base_price_usd.toFixed(4)}
                    </span>
                    {m.last_unit_price_usd != null && (
                      <span className="text-gray-500 ml-1">
                        (估 ${m.last_unit_price_usd.toFixed(4)})
                      </span>
                    )}
                  </div>
                  <div className="text-xs mt-1">
                    {active ? (
                      <span className="text-rose-300 font-mono">{p!.credit_cost} 点 · 已上架</span>
                    ) : p ? (
                      <span className="text-gray-500">已下架 · {p.credit_cost} 点</span>
                    ) : (
                      <span className="text-gray-500">未上架</span>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-auto">
                  <button
                    disabled={busy}
                    className="px-2 py-1 text-[11px] border border-white/10 rounded-lg disabled:opacity-50"
                    onClick={() =>
                      action(
                        () =>
                          api(patchUrl(m.model_id), {
                            method: "PATCH",
                            body: JSON.stringify(
                              active ? { shelf: false } : { shelf: true, is_active: true }
                            ),
                          }),
                        active ? "已下架" : "已上架"
                      )
                    }
                  >
                    {active ? "下架" : "上架"}
                  </button>
                  {p && (
                    <>
                      <button
                        disabled={busy}
                        className="px-2 py-1 text-[11px] border border-white/10 rounded-lg"
                        onClick={() =>
                          action(
                            () =>
                              api(patchUrl(m.model_id), {
                                method: "PATCH",
                                body: JSON.stringify({ is_recommended: !p.is_recommended }),
                              }),
                            p.is_recommended ? "已取消推荐" : "已设推荐"
                          )
                        }
                      >
                        {p.is_recommended ? "取消推荐" : "推荐"}
                      </button>
                      <button
                        disabled={busy}
                        className="px-2 py-1 text-[11px] border border-white/10 rounded-lg"
                        onClick={() => {
                          const cost = window.prompt("本站点数", String(p.credit_cost));
                          if (cost === null) return;
                          const n = Number(cost);
                          if (!Number.isInteger(n) || n < 1) return;
                          void action(
                            () =>
                              api(patchUrl(m.model_id), {
                                method: "PATCH",
                                body: JSON.stringify({ credit_cost: n }),
                              }),
                            "点数已更新"
                          );
                        }}
                      >
                        定价
                      </button>
                      <button
                        disabled={busy}
                        className="px-2 py-1 text-[11px] border border-white/10 rounded-lg"
                        onClick={() => {
                          const order = window.prompt("排序（越小越靠前）", String(p.sort_order));
                          if (order === null) return;
                          const n = Number(order);
                          if (!Number.isInteger(n) || n < 0) return;
                          void action(
                            () =>
                              api(patchUrl(m.model_id), {
                                method: "PATCH",
                                body: JSON.stringify({ sort_order: n }),
                              }),
                            "排序已更新"
                          );
                        }}
                      >
                        排序
                      </button>
                    </>
                  )}
                  <button
                    disabled={busy}
                    className="px-2 py-1 text-[11px] border border-white/10 rounded-lg"
                    onClick={() =>
                      action(
                        () =>
                          api(patchUrl(m.model_id), {
                            method: "PATCH",
                            body: JSON.stringify({ refresh_pricing: true }),
                          }),
                        "已刷新预估单价"
                      )
                    }
                  >
                    估价
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {data && data.models.length === 0 && (
        <p className="text-gray-500 text-sm mt-8">暂无模型。请先配置 Key 并点击「同步全库」。</p>
      )}

      {data && totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-8">
          <button
            disabled={page <= 1 || busy}
            className="px-3 py-1.5 text-sm border border-white/10 rounded-xl disabled:opacity-40"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            上一页
          </button>
          <span className="text-sm text-gray-400">
            {page} / {totalPages}
          </span>
          <button
            disabled={page >= totalPages || busy}
            className="px-3 py-1.5 text-sm border border-white/10 rounded-xl disabled:opacity-40"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}
