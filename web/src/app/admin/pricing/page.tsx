"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";

type Tab = "products" | "mappings" | "packages" | "tiers" | "plans";

const MODES = ["txt2img", "img2img", "imgedit", "undress", "txt2vid", "img2vid"] as const;

const MODE_LABEL: Record<string, string> = {
  txt2img: "文字生图",
  img2img: "图片生图",
  imgedit: "图片编辑",
  undress: "脱衣模式",
  txt2vid: "文字生视频",
  img2vid: "图片生视频",
};

const TIER_LABEL: Record<string, string> = { low: "低档", mid: "中档", high: "高档" };

interface Product {
  id: number;
  mode: string;
  tier: string;
  spicy: boolean;
  label: string;
  description: string;
  credit_cost: number;
  batch_four_multiplier: number;
  unit_seconds: number;
  requires_vip: boolean;
  is_active: boolean;
  is_default: boolean;
  sort_order: number;
  provider: string;
  provider_model_id: string;
  provider_model_name: string | null;
  provider_cost_usd: number | null;
  margin_percent: number | null;
  is_bound: boolean;
  ref_credits: number;
  ref_label: string;
  price_multiplier_bps: number;
  effective_multiplier_bps: number;
  retail_usd: number;
  default_inputs: Record<string, unknown>;
  ignored_params?: string[];
  ignored_default_inputs?: string[];
}

interface BridgeModel {
  model_id: string;
  name: string;
  type: string;
  tags: string[];
  base_price_usd: number;
  last_unit_price_usd: number | null;
}

interface Mapping {
  id: number;
  mode: string;
  ui_key: string;
  provider_path: string;
  value_map: Record<string, unknown>;
  options: Array<{ value: string; label: string }>;
  enabled: boolean;
  sort_order: number;
}

interface CreditPkg {
  id: number;
  credits: number;
  price_cents: number;
  label: string;
  badge: string | null;
  is_active: boolean;
  sort_order: number;
}

interface VipTier {
  id: number;
  code: string;
  name: string;
  rank: number;
  discount_bps: number;
  discount_percent: number;
  plaything_access: boolean;
  is_active: boolean;
}

interface VipPlan {
  id: number;
  tier_id: number;
  label: string;
  price_cents: number;
  bonus_credits: number;
  duration_days: number;
  is_active: boolean;
  sort_order: number;
  tier: VipTier;
}

const TABS: { id: Tab; label: string }[] = [
  { id: "products", label: "生成产品" },
  { id: "mappings", label: "参数映射" },
  { id: "packages", label: "充值套餐" },
  { id: "tiers", label: "VIP 等级" },
  { id: "plans", label: "VIP 套餐" },
];

export default function AdminPricingPage() {
  const [tab, setTab] = useState<Tab>("products");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [packages, setPackages] = useState<CreditPkg[]>([]);
  const [tiers, setTiers] = useState<VipTier[]>([]);
  const [plans, setPlans] = useState<VipPlan[]>([]);

  const [unbound, setUnbound] = useState(0);
  const [catalogSynced, setCatalogSynced] = useState(0);
  const [bridgeFor, setBridgeFor] = useState<Product | null>(null);
  useBodyScrollLock(Boolean(bridgeFor));
  const [bridgeModels, setBridgeModels] = useState<BridgeModel[]>([]);
  const [bridgeTags, setBridgeTags] = useState<string[]>([]);
  const [bridgeQuery, setBridgeQuery] = useState("");
  const [bridgeTag, setBridgeTag] = useState("");
  const [mappingForm, setMappingForm] = useState({
    mode: "txt2img",
    ui_key: "",
    provider_path: "",
    options_json: '[{"value":"","label":""}]',
    enabled: true,
  });
  const [pkgForm, setPkgForm] = useState({
    credits: 100,
    price_cents: 2900,
    label: "基础包",
    badge: "",
  });
  const [tierForm, setTierForm] = useState({
    code: "",
    name: "",
    rank: 1,
    discount_percent: 0,
  });
  const [planForm, setPlanForm] = useState({
    tier_id: 0,
    label: "",
    price_cents: 9900,
    bonus_credits: 800,
    duration_days: 30,
  });

  const load = useCallback(async () => {
    try {
      const [p, m, c, t, pl] = await Promise.all([
        api<{ products: Product[]; unbound: number; catalog_synced: number }>(
          "/api/admin/pricing/products"
        ),
        api<{ mappings: Mapping[] }>("/api/admin/pricing/param-mappings"),
        api<{ packages: CreditPkg[] }>("/api/admin/pricing/credit-packages"),
        api<{ tiers: VipTier[] }>("/api/admin/pricing/vip-tiers"),
        api<{ plans: VipPlan[] }>("/api/admin/pricing/vip-plans"),
      ]);
      setProducts(p.products);
      setUnbound(p.unbound);
      setCatalogSynced(p.catalog_synced);
      setMappings(m.mappings);
      setPackages(c.packages);
      setTiers(t.tiers);
      setPlans(pl.plans);
      if (!planForm.tier_id && t.tiers[0]) {
        setPlanForm((f) => ({ ...f, tier_id: t.tiers[0].id }));
      }
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "加载失败");
    }
  }, [planForm.tier_id]);

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

  const productsByMode = useMemo(() => {
    const map: Record<string, Product[]> = {};
    for (const p of products) {
      (map[p.mode] ??= []).push(p);
    }
    return map;
  }, [products]);

  const fetchBridge = useCallback(
    async (product: Product, q: string, tag: string) => {
      const params = new URLSearchParams({
        mode: product.mode,
        tier: product.tier,
        spicy: product.spicy ? "1" : "0",
      });
      if (q.trim()) params.set("q", q.trim());
      if (tag) params.set("tag", tag);
      try {
        const data = await api<{ models: BridgeModel[]; tags: string[] }>(
          `/api/admin/pricing/bridge-models?${params}`
        );
        setBridgeModels(data.models);
        setBridgeTags(data.tags);
      } catch {
        setBridgeModels([]);
      }
    },
    []
  );

  const openBridge = useCallback(
    async (product: Product) => {
      setBridgeFor(product);
      setBridgeQuery("");
      setBridgeTag("");
      await fetchBridge(product, "", "");
    },
    [fetchBridge]
  );

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tighter mb-1">价格体系</h1>
        <p className="text-ink-muted text-sm">
          生成产品扣点 · 参数映射 · 充值套餐 · 多等级 VIP 折扣
        </p>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm rounded-2xl border ${
              tab === t.id
                ? "bg-orange-700 border-orange-600 text-white"
                : "bg-black/[0.03] border-line text-ink-muted"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {msg && <p className="mb-4 text-sm text-amber-800">{msg}</p>}

      {tab === "products" && (
        <div className="space-y-6">
          <div className="glass rounded-3xl p-5">
            <div className="flex flex-wrap items-center gap-3 justify-between">
              <div className="text-sm text-ink-muted">
                档位矩阵固定为 <b>5 模式 × 档位 × 普通/Spicy</b>，不支持增删；管理端只做绑定模型、调价与上下架。
                <div className="text-xs text-ink-subtle mt-1">
                  桥接模型<b>全部由你手工指定</b>，目录同步与版本升级都不会自动改动绑定。
                  未绑定的档位对用户隐藏，不会出现点了必然失败的情况。
                </div>
                <div className="text-xs text-ink-subtle mt-1">
                  已同步 WaveSpeed 模型 {catalogSynced} 个
                  {unbound > 0 && (
                    <span className="text-amber-800"> · {unbound} 个档位未绑定</span>
                  )}
                  <span className="text-ink-subtle">
                    {" "}
                    · 在「玩物专区 → 模型库」给模型贴类型标签后，这里可按标签筛选
                  </span>
                </div>
              </div>
              <button
                disabled={busy}
                title="仅填补当前未绑定的档位，已绑定的不会被覆盖"
                className="px-4 py-2 text-sm font-semibold border border-line hover:border-line-strong rounded-2xl disabled:opacity-50"
                onClick={() => {
                  if (!confirm("按内置候选表填补未绑定的档位？已绑定的不受影响。")) return;
                  void action(
                    () => api("/api/admin/pricing/products", { method: "POST" }),
                    "已填补未绑定档位"
                  );
                }}
              >
                按候选表填充空档位
              </button>
            </div>
          </div>

          {MODES.map((mode) => (
            <div key={mode} className="space-y-2">
              <h2 className="text-sm font-semibold text-ink-muted">
                {MODE_LABEL[mode]} <span className="text-ink-subtle font-mono">{mode}</span>
              </h2>
              {(productsByMode[mode] ?? []).map((p) => (
                <div
                  key={p.id}
                  className={`glass rounded-2xl p-4 flex flex-wrap items-center gap-3 ${
                    p.spicy ? "ring-1 ring-fuchsia-500/30" : ""
                  } ${!p.is_bound ? "opacity-70" : ""}`}
                >
                  <div className="flex-1 min-w-[260px]">
                    <div className="font-medium flex items-center gap-2 flex-wrap">
                      <span>{p.label}</span>
                      <span className="text-[10px] px-1.5 py-0.5 bg-black/[0.06] rounded">
                        {TIER_LABEL[p.tier] ?? p.tier}
                      </span>
                      {p.spicy && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-fuchsia-700 text-white rounded font-bold">
                          SPICY · 会员专属
                        </span>
                      )}
                      {!p.is_active && <span className="text-xs text-ink-subtle">停用</span>}
                      {!p.is_bound && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/20 text-amber-800 rounded">
                          未绑定模型
                        </span>
                      )}
                    </div>

                    <div className="text-xs text-ink-muted mt-1">
                      {p.credit_cost} 点
                      {p.unit_seconds > 0 ? ` / ${p.unit_seconds}s` : ""} · 售价 $
                      {p.retail_usd.toFixed(3)}
                      {p.provider_cost_usd != null && (
                        <>
                          {" "}
                          · 成本 ${p.provider_cost_usd.toFixed(4)}
                          {p.margin_percent != null && (
                            <span
                              className={
                                p.margin_percent >= 40
                                  ? " text-emerald-700"
                                  : p.margin_percent >= 0
                                    ? " text-amber-800"
                                    : " text-red-700"
                              }
                            >
                              {" "}
                              毛利 {p.margin_percent}%
                            </span>
                          )}
                        </>
                      )}
                    </div>

                    <div className="text-[11px] text-ink-subtle mt-0.5">
                      对标 {p.ref_label || `${p.ref_credits} 分`} × {p.price_multiplier_bps / 100}%
                      {p.effective_multiplier_bps > 0 &&
                        p.effective_multiplier_bps !== p.price_multiplier_bps && (
                          <span className="text-amber-800">
                            {" "}
                            （取整后实际 {p.effective_multiplier_bps / 100}%）
                          </span>
                        )}
                    </div>

                    <div className="text-[11px] font-mono text-ink-subtle mt-0.5 truncate">
                      {p.is_bound ? `${p.provider}: ${p.provider_model_id}` : "—"}
                    </div>
                    {(p.ignored_params?.length || p.ignored_default_inputs?.length) && (
                      <div className="text-[11px] text-amber-800/90 mt-1">
                        <i className="fas fa-triangle-exclamation mr-1" />
                        该模型不支持，配置将被忽略：
                        {[...(p.ignored_params ?? []), ...(p.ignored_default_inputs ?? [])].join("、")}
                      </div>
                    )}
                  </div>

                  <button
                    disabled={busy}
                    className="px-3 py-1.5 text-xs border border-sky-500/30 text-sky-700 rounded-xl"
                    onClick={() => void openBridge(p)}
                  >
                    绑定模型
                  </button>
                  <button
                    disabled={busy}
                    className="px-3 py-1.5 text-xs border border-line rounded-xl"
                    onClick={() => {
                      const cost = prompt(`「${p.label}」新扣点`, String(p.credit_cost));
                      if (!cost) return;
                      void action(
                        () =>
                          api(`/api/admin/pricing/products/${p.id}`, {
                            method: "PATCH",
                            body: JSON.stringify({ credit_cost: Number(cost) }),
                          }),
                        "已更新扣点"
                      );
                    }}
                  >
                    改价
                  </button>
                  <button
                    disabled={busy}
                    className="px-3 py-1.5 text-xs border border-line rounded-xl"
                    onClick={() => {
                      const pct = prompt(
                        `「${p.label}」倍率（%，相对 ZenCreator 对标价 ${p.ref_credits} 分）`,
                        String(p.price_multiplier_bps / 100)
                      );
                      if (!pct) return;
                      void action(
                        () =>
                          api(`/api/admin/pricing/products/${p.id}`, {
                            method: "PATCH",
                            body: JSON.stringify({
                              price_multiplier_bps: Math.round(Number(pct) * 100),
                            }),
                          }),
                        "已按倍率重算扣点"
                      );
                    }}
                  >
                    调倍率
                  </button>
                  <button
                    disabled={busy}
                    className="px-3 py-1.5 text-xs border border-line rounded-xl"
                    onClick={() =>
                      action(
                        () =>
                          api(`/api/admin/pricing/products/${p.id}`, {
                            method: "PATCH",
                            body: JSON.stringify({ is_active: !p.is_active }),
                          }),
                        p.is_active ? "已停用" : "已启用"
                      )
                    }
                  >
                    {p.is_active ? "停用" : "启用"}
                  </button>
                </div>
              ))}
            </div>
          ))}

          {bridgeFor && (
            <div
              className="fixed inset-0 z-50 scrim flex items-center justify-center p-4"
              onClick={() => setBridgeFor(null)}
            >
              <div
                className="glass rounded-3xl p-5 w-full max-w-2xl max-h-[80vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-3">
                  <div className="font-semibold">绑定桥接模型 · {bridgeFor.label}</div>
                  <div className="text-xs text-ink-muted mt-1">
                    售价 ${bridgeFor.retail_usd.toFixed(3)} / 次；选成本低于此值的模型才有毛利。
                    生成端不会看到任何模型信息。
                  </div>
                </div>
                <input
                  autoFocus
                  placeholder="搜索 model_id / 名称 / 类型"
                  value={bridgeQuery}
                  onChange={(e) => {
                    setBridgeQuery(e.target.value);
                    void fetchBridge(bridgeFor, e.target.value, bridgeTag);
                  }}
                  className="bg-surface border border-line rounded-xl px-3 py-2 text-sm mb-2"
                />
                {bridgeTags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3 items-center">
                    <span className="text-[11px] text-ink-subtle">按标签：</span>
                    <button
                      type="button"
                      onClick={() => {
                        setBridgeTag("");
                        void fetchBridge(bridgeFor, bridgeQuery, "");
                      }}
                      className={`px-2 py-0.5 text-[11px] rounded-full border ${
                        bridgeTag === ""
                          ? "bg-sky-600/25 border-sky-500 text-sky-700"
                          : "border-line text-ink-muted"
                      }`}
                    >
                      全部
                    </button>
                    {bridgeTags.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => {
                          const next = bridgeTag === t ? "" : t;
                          setBridgeTag(next);
                          void fetchBridge(bridgeFor, bridgeQuery, next);
                        }}
                        className={`px-2 py-0.5 text-[11px] rounded-full border ${
                          bridgeTag === t
                            ? "bg-sky-600/25 border-sky-500 text-sky-700"
                            : "border-line text-ink-muted hover:text-ink"
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                )}
                <div className="overflow-y-auto overscroll-contain space-y-1.5 flex-1">
                  {bridgeModels.length === 0 && (
                    <p className="text-sm text-ink-subtle py-6 text-center">
                      没有匹配的模型。请先到「玩物专区 → 模型库」同步目录，并给模型贴上类型标签。
                    </p>
                  )}
                  {bridgeModels.map((m) => {
                    const cost = m.last_unit_price_usd ?? m.base_price_usd;
                    const margin =
                      cost > 0 && bridgeFor.retail_usd > 0
                        ? ((bridgeFor.retail_usd - cost) / bridgeFor.retail_usd) * 100
                        : null;
                    return (
                      <button
                        key={m.model_id}
                        disabled={busy}
                        onClick={() => {
                          const id = bridgeFor.id;
                          setBridgeFor(null);
                          void action(
                            () =>
                              api(`/api/admin/pricing/products/${id}`, {
                                method: "PATCH",
                                body: JSON.stringify({ provider_model_id: m.model_id }),
                              }),
                            `已绑定 ${m.model_id}`
                          );
                        }}
                        className={`w-full text-left px-3 py-2 rounded-xl border text-sm ${
                          m.model_id === bridgeFor.provider_model_id
                            ? "bg-sky-600/20 border-sky-500 text-white"
                            : "bg-black/[0.03] border-line hover:border-line-strong"
                        }`}
                      >
                        <div className="font-mono text-xs truncate">{m.model_id}</div>
                        <div className="text-[11px] text-ink-muted flex gap-2 flex-wrap items-center">
                          <span>{m.name}</span>
                          {m.tags.map((t) => (
                            <span
                              key={t}
                              className="px-1.5 py-px rounded bg-sky-500/15 text-sky-700 border border-sky-500/25"
                            >
                              {t}
                            </span>
                          ))}
                          {m.type && <span className="text-ink-subtle">{m.type}</span>}
                          <span>${cost.toFixed(4)}</span>
                          {margin !== null && (
                            <span className={margin >= 40 ? "text-emerald-700" : margin >= 0 ? "text-amber-800" : "text-red-700"}>
                              毛利 {margin.toFixed(0)}%
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3 flex justify-between">
                  <button
                    className="px-3 py-1.5 text-xs border border-red-500/30 text-red-700 rounded-xl"
                    onClick={() => {
                      const id = bridgeFor.id;
                      setBridgeFor(null);
                      void action(
                        () =>
                          api(`/api/admin/pricing/products/${id}`, {
                            method: "PATCH",
                            body: JSON.stringify({ provider_model_id: "" }),
                          }),
                        "已解绑（该档位对用户隐藏）"
                      );
                    }}
                  >
                    解绑
                  </button>
                  <button
                    className="px-3 py-1.5 text-xs border border-line rounded-xl"
                    onClick={() => setBridgeFor(null)}
                  >
                    关闭
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "mappings" && (
        <div className="space-y-4">
          <form
            className="glass rounded-3xl p-5 grid grid-cols-1 md:grid-cols-2 gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              let options: Array<{ value: string; label: string }> = [];
              try {
                options = JSON.parse(mappingForm.options_json) as Array<{
                  value: string;
                  label: string;
                }>;
              } catch {
                setMsg("options JSON 无效");
                return;
              }
              void action(
                () =>
                  api("/api/admin/pricing/param-mappings", {
                    method: "POST",
                    body: JSON.stringify({
                      mode: mappingForm.mode,
                      ui_key: mappingForm.ui_key,
                      provider_path: mappingForm.provider_path,
                      options,
                      enabled: mappingForm.enabled,
                    }),
                  }),
                "映射已添加"
              );
            }}
          >
            <select
              value={mappingForm.mode}
              onChange={(e) => setMappingForm({ ...mappingForm, mode: e.target.value })}
              className="bg-surface border border-line rounded-xl px-3 py-2 text-sm"
            >
              {MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <input
              required
              placeholder="UI key（如 ratio）"
              value={mappingForm.ui_key}
              onChange={(e) => setMappingForm({ ...mappingForm, ui_key: e.target.value })}
              className="bg-surface border border-line rounded-xl px-3 py-2 text-sm"
            />
            <input
              required
              placeholder="上游字段名（如 aspect_ratio；下划线开头仅本地）"
              value={mappingForm.provider_path}
              onChange={(e) => setMappingForm({ ...mappingForm, provider_path: e.target.value })}
              className="bg-surface border border-line rounded-xl px-3 py-2 text-sm"
            />
            <textarea
              value={mappingForm.options_json}
              onChange={(e) => setMappingForm({ ...mappingForm, options_json: e.target.value })}
              className="md:col-span-2 bg-surface border border-line rounded-xl px-3 py-2 text-xs font-mono min-h-[80px]"
            />
            <button
              type="submit"
              disabled={busy}
              className="md:col-span-2 px-4 py-2.5 text-sm font-semibold bg-orange-600 rounded-2xl disabled:opacity-50 text-white"
            >
              添加映射
            </button>
          </form>

          {mappings.map((m) => (
            <div key={m.id} className="glass rounded-2xl p-4 flex flex-wrap gap-3 items-center">
              <div className="flex-1 text-sm">
                <div className="font-medium">
                  {m.mode} · {m.ui_key} → {m.provider_path}
                  {!m.enabled && <span className="text-ink-subtle text-xs ml-2">停用</span>}
                </div>
                <div className="text-xs text-ink-subtle font-mono">
                  options: {m.options.map((o) => o.value).join(", ") || "—"}
                </div>
              </div>
              <button
                disabled={busy}
                className="px-3 py-1.5 text-xs border border-line rounded-xl"
                onClick={() =>
                  action(
                    () =>
                      api(`/api/admin/pricing/param-mappings/${m.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ enabled: !m.enabled }),
                      }),
                    m.enabled ? "已停用" : "已启用"
                  )
                }
              >
                {m.enabled ? "停用" : "启用"}
              </button>
              <button
                disabled={busy}
                className="px-3 py-1.5 text-xs border border-red-500/30 text-red-700 rounded-xl"
                onClick={() => {
                  if (!confirm("删除该映射？")) return;
                  void action(
                    () =>
                      api(`/api/admin/pricing/param-mappings/${m.id}`, { method: "DELETE" }),
                    "已删除"
                  );
                }}
              >
                删除
              </button>
            </div>
          ))}
        </div>
      )}

      {tab === "packages" && (
        <div className="space-y-4">
          <form
            className="glass rounded-3xl p-5 grid grid-cols-1 md:grid-cols-4 gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void action(
                () =>
                  api("/api/admin/pricing/credit-packages", {
                    method: "POST",
                    body: JSON.stringify({
                      ...pkgForm,
                      badge: pkgForm.badge || null,
                    }),
                  }),
                "套餐已添加"
              );
            }}
          >
            <input
              type="number"
              required
              placeholder="点数"
              value={pkgForm.credits}
              onChange={(e) => setPkgForm({ ...pkgForm, credits: Number(e.target.value) })}
              className="bg-surface border border-line rounded-xl px-3 py-2 text-sm"
            />
            <input
              type="number"
              required
              placeholder="美分"
              value={pkgForm.price_cents}
              onChange={(e) => setPkgForm({ ...pkgForm, price_cents: Number(e.target.value) })}
              className="bg-surface border border-line rounded-xl px-3 py-2 text-sm"
            />
            <input
              required
              placeholder="名称"
              value={pkgForm.label}
              onChange={(e) => setPkgForm({ ...pkgForm, label: e.target.value })}
              className="bg-surface border border-line rounded-xl px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-2 text-sm font-semibold bg-orange-600 rounded-2xl disabled:opacity-50 text-white"
            >
              添加
            </button>
          </form>
          {packages.map((p) => (
            <div key={p.id} className="glass rounded-2xl p-4 flex flex-wrap gap-3 items-center">
              <div className="flex-1">
                <div className="font-medium">
                  {p.label} · {p.credits} 点 = ${(p.price_cents / 100).toFixed(2)}
                  {p.badge ? ` · ${p.badge}` : ""}
                  {!p.is_active && <span className="text-ink-subtle text-xs ml-2">停用</span>}
                </div>
              </div>
              <button
                disabled={busy}
                className="px-3 py-1.5 text-xs border border-line rounded-xl"
                onClick={() => {
                  const cents = prompt("新价格（美分）", String(p.price_cents));
                  if (!cents) return;
                  void action(
                    () =>
                      api(`/api/admin/pricing/credit-packages/${p.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ price_cents: Number(cents) }),
                      }),
                    "已改价"
                  );
                }}
              >
                改价
              </button>
              <button
                disabled={busy}
                className="px-3 py-1.5 text-xs border border-line rounded-xl"
                onClick={() =>
                  action(
                    () =>
                      api(`/api/admin/pricing/credit-packages/${p.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ is_active: !p.is_active }),
                      }),
                    p.is_active ? "已停用" : "已启用"
                  )
                }
              >
                {p.is_active ? "停用" : "启用"}
              </button>
              <button
                disabled={busy}
                className="px-3 py-1.5 text-xs border border-red-500/30 text-red-700 rounded-xl"
                onClick={() => {
                  if (!confirm("删除套餐？")) return;
                  void action(
                    () =>
                      api(`/api/admin/pricing/credit-packages/${p.id}`, { method: "DELETE" }),
                    "已删除"
                  );
                }}
              >
                删除
              </button>
            </div>
          ))}
        </div>
      )}

      {tab === "tiers" && (
        <div className="space-y-4">
          <form
            className="glass rounded-3xl p-5 grid grid-cols-1 md:grid-cols-4 gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void action(
                () =>
                  api("/api/admin/pricing/vip-tiers", {
                    method: "POST",
                    body: JSON.stringify(tierForm),
                  }),
                "等级已添加"
              );
            }}
          >
            <input
              required
              placeholder="code（vip3）"
              value={tierForm.code}
              onChange={(e) => setTierForm({ ...tierForm, code: e.target.value })}
              className="bg-surface border border-line rounded-xl px-3 py-2 text-sm"
            />
            <input
              required
              placeholder="名称"
              value={tierForm.name}
              onChange={(e) => setTierForm({ ...tierForm, name: e.target.value })}
              className="bg-surface border border-line rounded-xl px-3 py-2 text-sm"
            />
            <input
              type="number"
              min={0}
              max={100}
              placeholder="折扣%"
              value={tierForm.discount_percent}
              onChange={(e) =>
                setTierForm({ ...tierForm, discount_percent: Number(e.target.value) })
              }
              className="bg-surface border border-line rounded-xl px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-2 text-sm font-semibold bg-orange-600 rounded-2xl disabled:opacity-50 text-white"
            >
              添加等级
            </button>
          </form>
          {tiers.map((t) => (
            <div key={t.id} className="glass rounded-2xl p-4 flex flex-wrap gap-3 items-center">
              <div className="flex-1">
                <div className="font-medium">
                  {t.name} ({t.code}) · 折扣 {t.discount_percent}% · rank {t.rank}
                  {t.plaything_access && (
                    <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-800">
                      玩物专区
                    </span>
                  )}
                  {!t.is_active && <span className="text-ink-subtle text-xs ml-2">停用</span>}
                </div>
              </div>
              <button
                disabled={busy}
                className="px-3 py-1.5 text-xs border border-line rounded-xl"
                onClick={() => {
                  const pct = prompt("折扣百分比（0-100）", String(t.discount_percent));
                  if (pct === null) return;
                  void action(
                    () =>
                      api(`/api/admin/pricing/vip-tiers/${t.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ discount_percent: Number(pct) }),
                      }),
                    "已更新折扣"
                  );
                }}
              >
                改折扣
              </button>
              <button
                disabled={busy}
                className="px-3 py-1.5 text-xs border border-line rounded-xl"
                onClick={() =>
                  action(
                    () =>
                      api(`/api/admin/pricing/vip-tiers/${t.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ plaything_access: !t.plaything_access }),
                      }),
                    t.plaything_access ? "已关闭玩物门禁" : "已开启玩物门禁"
                  )
                }
              >
                {t.plaything_access ? "关玩物" : "开玩物"}
              </button>
              <button
                disabled={busy}
                className="px-3 py-1.5 text-xs border border-line rounded-xl"
                onClick={() =>
                  action(
                    () =>
                      api(`/api/admin/pricing/vip-tiers/${t.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ is_active: !t.is_active }),
                      }),
                    t.is_active ? "已停用" : "已启用"
                  )
                }
              >
                {t.is_active ? "停用" : "启用"}
              </button>
            </div>
          ))}
        </div>
      )}

      {tab === "plans" && (
        <div className="space-y-4">
          <form
            className="glass rounded-3xl p-5 grid grid-cols-1 md:grid-cols-3 gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void action(
                () =>
                  api("/api/admin/pricing/vip-plans", {
                    method: "POST",
                    body: JSON.stringify(planForm),
                  }),
                "VIP 套餐已添加"
              );
            }}
          >
            <select
              value={planForm.tier_id}
              onChange={(e) => setPlanForm({ ...planForm, tier_id: Number(e.target.value) })}
              className="bg-surface border border-line rounded-xl px-3 py-2 text-sm"
            >
              {tiers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <input
              required
              placeholder="套餐名"
              value={planForm.label}
              onChange={(e) => setPlanForm({ ...planForm, label: e.target.value })}
              className="bg-surface border border-line rounded-xl px-3 py-2 text-sm"
            />
            <input
              type="number"
              required
              placeholder="美分"
              value={planForm.price_cents}
              onChange={(e) => setPlanForm({ ...planForm, price_cents: Number(e.target.value) })}
              className="bg-surface border border-line rounded-xl px-3 py-2 text-sm"
            />
            <input
              type="number"
              placeholder="赠点"
              value={planForm.bonus_credits}
              onChange={(e) =>
                setPlanForm({ ...planForm, bonus_credits: Number(e.target.value) })
              }
              className="bg-surface border border-line rounded-xl px-3 py-2 text-sm"
            />
            <input
              type="number"
              placeholder="天数"
              value={planForm.duration_days}
              onChange={(e) =>
                setPlanForm({ ...planForm, duration_days: Number(e.target.value) })
              }
              className="bg-surface border border-line rounded-xl px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-2 text-sm font-semibold bg-orange-600 rounded-2xl disabled:opacity-50 text-white"
            >
              添加套餐
            </button>
          </form>
          {plans.map((p) => (
            <div key={p.id} className="glass rounded-2xl p-4 flex flex-wrap gap-3 items-center">
              <div className="flex-1">
                <div className="font-medium">
                  {p.label} → {p.tier.name} · ${(p.price_cents / 100).toFixed(2)} · 赠
                  {p.bonus_credits}点 · {p.duration_days}天
                  {!p.is_active && <span className="text-ink-subtle text-xs ml-2">停用</span>}
                </div>
              </div>
              <button
                disabled={busy}
                className="px-3 py-1.5 text-xs border border-line rounded-xl"
                onClick={() => {
                  const cents = prompt("新月费（美分）", String(p.price_cents));
                  if (!cents) return;
                  void action(
                    () =>
                      api(`/api/admin/pricing/vip-plans/${p.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ price_cents: Number(cents) }),
                      }),
                    "已改价"
                  );
                }}
              >
                改价
              </button>
              <button
                disabled={busy}
                className="px-3 py-1.5 text-xs border border-line rounded-xl"
                onClick={() =>
                  action(
                    () =>
                      api(`/api/admin/pricing/vip-plans/${p.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ is_active: !p.is_active }),
                      }),
                    p.is_active ? "已停用" : "已启用"
                  )
                }
              >
                {p.is_active ? "停用" : "启用"}
              </button>
              <button
                disabled={busy}
                className="px-3 py-1.5 text-xs border border-red-500/30 text-red-700 rounded-xl"
                onClick={() => {
                  if (!confirm("删除套餐？")) return;
                  void action(
                    () => api(`/api/admin/pricing/vip-plans/${p.id}`, { method: "DELETE" }),
                    "已删除"
                  );
                }}
              >
                删除
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
