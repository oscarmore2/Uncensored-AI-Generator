"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { ProviderTabs } from "@/components/admin/ProviderTabs";
import { DEFAULT_PROVIDER, PROVIDER_META, type ProviderId } from "@/lib/providers/meta";

interface ProductInfo {
  id: number;
  label: string;
  credit_cost: number;
  is_active: boolean;
  is_recommended: boolean;
  sort_order: number;
  param_policy?: unknown;
}

interface CatalogModel {
  id: number;
  provider: ProviderId;
  model_id: string;
  name: string;
  type: string;
  description: string;
  base_price_usd: number;
  last_unit_price_usd: number | null;
  thumbnail_url: string | null;
  tags: string[];
  synced_at: string;
  product: ProductInfo | null;
}

interface ProviderInfo {
  id: ProviderId;
  label: string;
  short_label: string;
  supports_dynamic_pricing: boolean;
  synced_count: number;
}

interface ListResp {
  provider: ProviderId;
  total: number;
  page: number;
  page_size: number;
  last_synced_at: string | null;
  types: string[];
  tags: string[];
  models: CatalogModel[];
  providers: ProviderInfo[];
}

const MAX_TAGS = 12;
const SUGGESTED = [
  "文生图",
  "图生图",
  "图片编辑",
  "文生视频",
  "图生视频",
  "低档",
  "中档",
  "高档",
  "Spicy",
  "快速",
  "高画质",
  "低成本",
];

function splitTags(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,，]/)) {
    const tag = part.trim().slice(0, 24);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

export default function AdminModelsPage() {
  const [provider, setProvider] = useState<ProviderId>(DEFAULT_PROVIDER);
  const [data, setData] = useState<ListResp | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [tag, setTag] = useState("");
  const [tagEditFor, setTagEditFor] = useState<CatalogModel | null>(null);
  useBodyScrollLock(Boolean(tagEditFor));
  const [tagDraft, setTagDraft] = useState("");
  const [shelved, setShelved] = useState("");
  const [adult, setAdult] = useState(false);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ provider });
      if (q.trim()) params.set("q", q.trim());
      if (type) params.set("type", type);
      if (tag) params.set("tag", tag);
      if (shelved) params.set("shelved", shelved);
      if (adult) params.set("adult", "1");
      params.set("page", String(page));
      params.set("page_size", "24");
      setData(await api<ListResp>(`/api/admin/models?${params}`));
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "加载失败");
    }
  }, [provider, q, type, tag, shelved, adult, page]);

  useEffect(() => {
    void load();
  }, [load]);

  // 换渠道时把上一个渠道的筛选条件清掉：两家的类型与标签集合完全不同，
  // 留着只会得到一个空列表，看起来像是没同步
  function switchProvider(next: ProviderId) {
    if (next === provider) return;
    setProvider(next);
    setQ("");
    setType("");
    setTag("");
    setShelved("");
    setAdult(false);
    setPage(1);
    setMsg("");
  }

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

  function patchUrl(m: CatalogModel) {
    const path = m.model_id
      .split("/")
      .map((s) => encodeURIComponent(s))
      .join("/");
    return `/api/admin/models/${m.provider}/${path}`;
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const meta = PROVIDER_META[provider];
  const dynamicPricing = meta.supportsDynamicPricing;

  return (
    <div>
      <div className="flex items-end justify-between mb-4 gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tighter mb-1">模型库</h1>
          <p className="text-ink-muted text-sm">
            按渠道同步全库 · 缩略图与调用成本 · 上架 / 推荐 / 本站点数
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/admin/providers"
            className="px-4 py-2.5 text-sm border border-line rounded-2xl hover:bg-black/[0.04]"
          >
            API Key
          </Link>
          <button
            disabled={busy}
            onClick={() =>
              action(async () => {
                const r = await api<{
                  upserted: number;
                  total: number;
                  schemasFetched: number;
                  schemasFailed: number;
                  seeded: number;
                }>("/api/admin/models/sync", {
                  method: "POST",
                  body: JSON.stringify({ provider }),
                });
                setMsg(
                  `${meta.label} 同步完成：${r.upserted}/${r.total} 个模型` +
                    (r.schemasFetched || r.schemasFailed
                      ? ` · 参数 schema 新抓 ${r.schemasFetched} 个${
                          r.schemasFailed ? `，失败 ${r.schemasFailed} 个` : ""
                        }`
                      : "")
                );
              }, "同步完成")
            }
            className="px-5 py-2.5 text-sm font-semibold bg-orange-700 hover:bg-orange-600 rounded-2xl disabled:opacity-50 text-white"
          >
            <i className={`fas fa-rotate mr-2 ${busy ? "fa-spin" : ""}`} />
            同步 {meta.shortLabel} 全库
          </button>
        </div>
      </div>

      <div className="mb-4">
        <ProviderTabs
          value={provider}
          onChange={switchProvider}
          info={(data?.providers ?? []).map((p) => ({
            id: p.id,
            label: p.label,
            count: p.synced_count,
          }))}
        />
      </div>

      <div className="glass rounded-2xl px-4 py-3 mb-5 text-xs text-ink-muted flex flex-wrap gap-x-4 gap-y-1">
        <span>
          {data?.last_synced_at
            ? `上次同步 ${new Date(data.last_synced_at).toLocaleString("zh-CN")}`
            : "该渠道尚未同步"}
        </span>
        <span>共 {data?.total ?? 0} 条</span>
        <span>
          成本口径：
          {dynamicPricing ? (
            <b className="text-ink">支持按入参实时估价</b>
          ) : (
            <b className="text-amber-800">仅目录基准价，无实时估价接口</b>
          )}
        </span>
      </div>

      {msg && <p className="mb-4 text-sm text-amber-800">{msg}</p>}

      <div className="flex flex-wrap gap-3 mb-6">
        <input
          value={q}
          onChange={(e) => {
            setPage(1);
            setQ(e.target.value);
          }}
          placeholder="搜索 model_id / 名称"
          className="bg-surface border border-line rounded-xl px-3 py-2 text-sm w-56"
        />
        <select
          value={type}
          onChange={(e) => {
            setPage(1);
            setType(e.target.value);
          }}
          className="bg-surface border border-line rounded-xl px-3 py-2 text-sm"
        >
          <option value="">全部类型</option>
          {(data?.types ?? []).map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          value={tag}
          onChange={(e) => {
            setPage(1);
            setTag(e.target.value);
          }}
          className="bg-surface border border-line rounded-xl px-3 py-2 text-sm"
        >
          <option value="">全部标签</option>
          {(data?.tags ?? []).map((t) => (
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
          className="bg-surface border border-line rounded-xl px-3 py-2 text-sm"
        >
          <option value="">上架状态</option>
          <option value="1">已有 Product</option>
          <option value="0">未上架</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          <input
            type="checkbox"
            checked={adult}
            onChange={(e) => {
              setPage(1);
              setAdult(e.target.checked);
            }}
          />
          敏感模型关键词
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {(data?.models ?? []).map((m) => {
          const p = m.product;
          const active = Boolean(p?.is_active);
          return (
            <div key={`${m.provider}/${m.model_id}`} className="glass rounded-2xl overflow-hidden flex flex-col">
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
                  <div className="w-full h-full flex items-center justify-center text-ink-subtle text-3xl font-black">
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
                  <div className="text-[10px] text-ink-subtle font-mono line-clamp-1">{m.model_id}</div>
                  <div className="text-xs text-ink-muted mt-1">
                    {m.type || "—"} ·{" "}
                    <span className="text-emerald-700 font-mono">
                      ${m.base_price_usd.toFixed(4)}
                    </span>
                    {m.last_unit_price_usd != null && (
                      <span className="text-ink-subtle ml-1">
                        (估 ${m.last_unit_price_usd.toFixed(4)})
                      </span>
                    )}
                  </div>
                  <div className="text-xs mt-1">
                    {active ? (
                      <span className="text-orange-700 font-mono">{p!.credit_cost} 点 · 已上架</span>
                    ) : p ? (
                      <span className="text-ink-subtle">已下架 · {p.credit_cost} 点</span>
                    ) : (
                      <span className="text-ink-subtle">未上架</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2 items-center">
                    {m.tags.map((t) => (
                      <button
                        key={t}
                        type="button"
                        title="按此标签筛选"
                        onClick={() => {
                          setPage(1);
                          setTag(t);
                        }}
                        className="px-1.5 py-0.5 text-[10px] rounded bg-sky-500/15 text-sky-700 border border-sky-500/25 hover:bg-sky-500/25"
                      >
                        {t}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        setTagEditFor(m);
                        setTagDraft(m.tags.join(", "));
                      }}
                      className="px-1.5 py-0.5 text-[10px] rounded border border-line text-ink-muted hover:text-ink"
                    >
                      {m.tags.length ? "编辑标签" : "+ 标签"}
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-auto">
                  <button
                    disabled={busy}
                    className="px-2 py-1 text-[11px] border border-line rounded-lg disabled:opacity-50"
                    onClick={() =>
                      action(
                        () =>
                          api(patchUrl(m), {
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
                        className="px-2 py-1 text-[11px] border border-line rounded-lg"
                        onClick={() =>
                          action(
                            () =>
                              api(patchUrl(m), {
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
                        className="px-2 py-1 text-[11px] border border-line rounded-lg"
                        onClick={() => {
                          const cost = window.prompt("本站点数", String(p.credit_cost));
                          if (cost === null) return;
                          const n = Number(cost);
                          if (!Number.isInteger(n) || n < 1) return;
                          void action(
                            () =>
                              api(patchUrl(m), {
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
                        className="px-2 py-1 text-[11px] border border-line rounded-lg"
                        onClick={() => {
                          const order = window.prompt("排序（越小越靠前）", String(p.sort_order));
                          if (order === null) return;
                          const n = Number(order);
                          if (!Number.isInteger(n) || n < 0) return;
                          void action(
                            () =>
                              api(patchUrl(m), {
                                method: "PATCH",
                                body: JSON.stringify({ sort_order: n }),
                              }),
                            "排序已更新"
                          );
                        }}
                      >
                        排序
                      </button>
                      <button
                        disabled={busy}
                        className="px-2 py-1 text-[11px] border border-line rounded-lg"
                        onClick={() => {
                          const current = p.param_policy
                            ? JSON.stringify(p.param_policy, null, 2)
                            : JSON.stringify(
                                {
                                  duration: {
                                    tiers: [5, 10],
                                    labels: ["5 秒", "10 秒"],
                                    default: 5,
                                  },
                                },
                                null,
                                2
                              );
                          const raw = window.prompt("参数策略 JSON（档位/媒体约束）", current);
                          if (raw === null) return;
                          try {
                            const parsed = JSON.parse(raw);
                            void action(
                              () =>
                                api(patchUrl(m), {
                                  method: "PATCH",
                                  body: JSON.stringify({ param_policy: parsed }),
                                }),
                              "策略已更新"
                            );
                          } catch {
                            setMsg("JSON 无效");
                          }
                        }}
                      >
                        策略
                      </button>
                    </>
                  )}
                  {dynamicPricing && (
                    <button
                      disabled={busy}
                      className="px-2 py-1 text-[11px] border border-line rounded-lg"
                      onClick={() =>
                        action(
                          () =>
                            api(patchUrl(m), {
                              method: "PATCH",
                              body: JSON.stringify({ refresh_pricing: true }),
                            }),
                          "已刷新预估单价"
                        )
                      }
                    >
                      估价
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {data && data.models.length === 0 && (
        <p className="text-ink-subtle text-sm mt-8">
          {meta.label} 暂无模型。请先在「API Key」里配置该渠道的 Key，再点上方「同步 {meta.shortLabel} 全库」。
        </p>
      )}

      {data && totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-8">
          <button
            disabled={page <= 1 || busy}
            className="px-3 py-1.5 text-sm border border-line rounded-xl disabled:opacity-40"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            上一页
          </button>
          <span className="text-sm text-ink-muted">
            {page} / {totalPages}
          </span>
          <button
            disabled={page >= totalPages || busy}
            className="px-3 py-1.5 text-sm border border-line rounded-xl disabled:opacity-40"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            下一页
          </button>
        </div>
      )}

      {tagEditFor && (
        <div
          className="fixed inset-0 z-50 scrim flex items-center justify-center p-4"
          onClick={() => setTagEditFor(null)}
        >
          <div
            className="glass max-h-[90vh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-3xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 font-semibold">编辑类型标签</div>
            <div className="text-[11px] text-ink-subtle font-mono mb-3 break-all">
              {PROVIDER_META[tagEditFor.provider].label} · {tagEditFor.model_id}
            </div>
            <p className="text-xs text-ink-muted mb-2">
              逗号分隔，最多 {MAX_TAGS} 个。标签只保存在本站，
              <b>不会被「同步全库」覆盖</b>；价格体系里绑定桥接模型时可按标签筛选。
            </p>
            <input
              autoFocus
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              placeholder="例如：文生视频, 高档, Spicy"
              className="w-full bg-surface border border-line rounded-xl px-3 py-2 text-sm mb-3"
            />
            <div className="flex flex-wrap gap-1.5 mb-4">
              {SUGGESTED.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    const current = splitTags(tagDraft);
                    if (current.some((x) => x.toLowerCase() === t.toLowerCase())) return;
                    setTagDraft([...current, t].join(", "));
                  }}
                  className="px-2 py-0.5 text-[11px] rounded-full border border-line text-ink-muted hover:border-sky-500/50 hover:text-sky-800"
                >
                  + {t}
                </button>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button
                className="px-3 py-1.5 text-xs border border-line rounded-xl"
                onClick={() => setTagEditFor(null)}
              >
                取消
              </button>
              <button
                disabled={busy}
                className="px-4 py-1.5 text-xs font-semibold bg-orange-700 hover:bg-orange-600 rounded-xl disabled:opacity-50 text-white"
                onClick={() => {
                  const target = tagEditFor;
                  const tags = splitTags(tagDraft);
                  setTagEditFor(null);
                  void action(
                    () =>
                      api(patchUrl(target), {
                        method: "PATCH",
                        body: JSON.stringify({ tags }),
                      }),
                    "标签已保存"
                  );
                }}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
