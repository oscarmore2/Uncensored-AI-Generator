"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/client";

type Tab = "products" | "mappings" | "packages" | "tiers" | "plans";

const MODES = ["txt2img", "txt2vid", "img2img", "img2vid", "undress"] as const;

interface Product {
  id: number;
  mode: string;
  zen_tool: string;
  zen_model: string;
  variant_key: string;
  label: string;
  credit_cost: number;
  batch_four_multiplier: number;
  is_active: boolean;
  is_default: boolean;
  sort_order: number;
}

interface Mapping {
  id: number;
  mode: string;
  ui_key: string;
  zen_path: string;
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

  const [productForm, setProductForm] = useState({
    mode: "txt2img",
    zen_tool: "by_prompt",
    zen_model: "",
    variant_key: "",
    label: "",
    credit_cost: 2,
    batch_four_multiplier: 1.5,
    is_default: false,
  });
  const [mappingForm, setMappingForm] = useState({
    mode: "txt2img",
    ui_key: "",
    zen_path: "",
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
        api<{ products: Product[] }>("/api/admin/pricing/products"),
        api<{ mappings: Mapping[] }>("/api/admin/pricing/param-mappings"),
        api<{ packages: CreditPkg[] }>("/api/admin/pricing/credit-packages"),
        api<{ tiers: VipTier[] }>("/api/admin/pricing/vip-tiers"),
        api<{ plans: VipPlan[] }>("/api/admin/pricing/vip-plans"),
      ]);
      setProducts(p.products);
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

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tighter mb-1">价格体系</h1>
        <p className="text-gray-400 text-sm">
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
                ? "bg-rose-600 border-rose-500 text-white"
                : "bg-white/5 border-white/10 text-gray-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {msg && <p className="mb-4 text-sm text-amber-300">{msg}</p>}

      {tab === "products" && (
        <div className="space-y-6">
          <form
            className="glass rounded-3xl p-5 grid grid-cols-1 md:grid-cols-3 gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void action(
                () =>
                  api("/api/admin/pricing/products", {
                    method: "POST",
                    body: JSON.stringify(productForm),
                  }),
                "产品已添加"
              );
            }}
          >
            <select
              value={productForm.mode}
              onChange={(e) => setProductForm({ ...productForm, mode: e.target.value })}
              className="bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm"
            >
              {MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <input
              required
              placeholder="标签"
              value={productForm.label}
              onChange={(e) => setProductForm({ ...productForm, label: e.target.value })}
              className="bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm"
            />
            <input
              required
              placeholder="Zen Model"
              value={productForm.zen_model}
              onChange={(e) => setProductForm({ ...productForm, zen_model: e.target.value })}
              className="bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm font-mono"
            />
            <input
              required
              placeholder="Zen Tool"
              value={productForm.zen_tool}
              onChange={(e) => setProductForm({ ...productForm, zen_tool: e.target.value })}
              className="bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm font-mono"
            />
            <input
              placeholder="variant（脱衣: female/male/couple）"
              value={productForm.variant_key}
              onChange={(e) => setProductForm({ ...productForm, variant_key: e.target.value })}
              className="bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm"
            />
            <input
              type="number"
              min={1}
              required
              value={productForm.credit_cost}
              onChange={(e) =>
                setProductForm({ ...productForm, credit_cost: Number(e.target.value) })
              }
              className="bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm"
            />
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={productForm.is_default}
                onChange={(e) => setProductForm({ ...productForm, is_default: e.target.checked })}
              />
              设为该模式默认
            </label>
            <button
              type="submit"
              disabled={busy}
              className="md:col-span-3 px-4 py-2.5 text-sm font-semibold bg-rose-600 hover:bg-rose-500 rounded-2xl disabled:opacity-50"
            >
              添加产品
            </button>
          </form>

          {MODES.map((mode) => (
            <div key={mode} className="space-y-2">
              <h2 className="text-sm font-semibold text-gray-300">{mode}</h2>
              {(productsByMode[mode] ?? []).map((p) => (
                <div
                  key={p.id}
                  className={`glass rounded-2xl p-4 flex flex-wrap items-center gap-3 ${
                    p.is_default ? "ring-1 ring-emerald-500/40" : ""
                  }`}
                >
                  <div className="flex-1 min-w-[200px]">
                    <div className="font-medium">
                      {p.label}{" "}
                      {!p.is_active && <span className="text-xs text-gray-500">停用</span>}
                      {p.is_default && (
                        <span className="text-[10px] ml-2 px-2 py-0.5 bg-emerald-500/20 text-emerald-300 rounded-full">
                          默认
                        </span>
                      )}
                    </div>
                    <div className="text-xs font-mono text-gray-400">
                      {p.zen_tool} / {p.zen_model}
                      {p.variant_key ? ` / ${p.variant_key}` : ""} · {p.credit_cost} 点
                      {p.batch_four_multiplier !== 1.5
                        ? ` · ×4=${p.batch_four_multiplier}`
                        : ""}
                    </div>
                  </div>
                  <button
                    disabled={busy}
                    className="px-3 py-1.5 text-xs border border-white/10 rounded-xl"
                    onClick={() => {
                      const cost = prompt("新扣点", String(p.credit_cost));
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
                  {!p.is_default && (
                    <button
                      disabled={busy}
                      className="px-3 py-1.5 text-xs border border-emerald-500/30 text-emerald-300 rounded-xl"
                      onClick={() =>
                        action(
                          () =>
                            api(`/api/admin/pricing/products/${p.id}`, {
                              method: "PATCH",
                              body: JSON.stringify({ is_default: true }),
                            }),
                          "已设为默认"
                        )
                      }
                    >
                      设默认
                    </button>
                  )}
                  <button
                    disabled={busy}
                    className="px-3 py-1.5 text-xs border border-white/10 rounded-xl"
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
                  <button
                    disabled={busy}
                    className="px-3 py-1.5 text-xs border border-red-500/30 text-red-300 rounded-xl"
                    onClick={() => {
                      if (!confirm(`删除「${p.label}」？`)) return;
                      void action(
                        () =>
                          api(`/api/admin/pricing/products/${p.id}`, { method: "DELETE" }),
                        "已删除"
                      );
                    }}
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
          ))}
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
                      zen_path: mappingForm.zen_path,
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
              className="bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm"
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
              className="bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm"
            />
            <input
              required
              placeholder="Zen path（如 ratio；_style 仅本地）"
              value={mappingForm.zen_path}
              onChange={(e) => setMappingForm({ ...mappingForm, zen_path: e.target.value })}
              className="bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm"
            />
            <textarea
              value={mappingForm.options_json}
              onChange={(e) => setMappingForm({ ...mappingForm, options_json: e.target.value })}
              className="md:col-span-2 bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-xs font-mono min-h-[80px]"
            />
            <button
              type="submit"
              disabled={busy}
              className="md:col-span-2 px-4 py-2.5 text-sm font-semibold bg-rose-600 rounded-2xl disabled:opacity-50"
            >
              添加映射
            </button>
          </form>

          {mappings.map((m) => (
            <div key={m.id} className="glass rounded-2xl p-4 flex flex-wrap gap-3 items-center">
              <div className="flex-1 text-sm">
                <div className="font-medium">
                  {m.mode} · {m.ui_key} → {m.zen_path}
                  {!m.enabled && <span className="text-gray-500 text-xs ml-2">停用</span>}
                </div>
                <div className="text-xs text-gray-500 font-mono">
                  options: {m.options.map((o) => o.value).join(", ") || "—"}
                </div>
              </div>
              <button
                disabled={busy}
                className="px-3 py-1.5 text-xs border border-white/10 rounded-xl"
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
                className="px-3 py-1.5 text-xs border border-red-500/30 text-red-300 rounded-xl"
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
              className="bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm"
            />
            <input
              type="number"
              required
              placeholder="美分"
              value={pkgForm.price_cents}
              onChange={(e) => setPkgForm({ ...pkgForm, price_cents: Number(e.target.value) })}
              className="bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm"
            />
            <input
              required
              placeholder="名称"
              value={pkgForm.label}
              onChange={(e) => setPkgForm({ ...pkgForm, label: e.target.value })}
              className="bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-2 text-sm font-semibold bg-rose-600 rounded-2xl disabled:opacity-50"
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
                  {!p.is_active && <span className="text-gray-500 text-xs ml-2">停用</span>}
                </div>
              </div>
              <button
                disabled={busy}
                className="px-3 py-1.5 text-xs border border-white/10 rounded-xl"
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
                className="px-3 py-1.5 text-xs border border-white/10 rounded-xl"
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
                className="px-3 py-1.5 text-xs border border-red-500/30 text-red-300 rounded-xl"
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
              className="bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm"
            />
            <input
              required
              placeholder="名称"
              value={tierForm.name}
              onChange={(e) => setTierForm({ ...tierForm, name: e.target.value })}
              className="bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm"
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
              className="bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-2 text-sm font-semibold bg-rose-600 rounded-2xl disabled:opacity-50"
            >
              添加等级
            </button>
          </form>
          {tiers.map((t) => (
            <div key={t.id} className="glass rounded-2xl p-4 flex flex-wrap gap-3 items-center">
              <div className="flex-1">
                <div className="font-medium">
                  {t.name} ({t.code}) · 折扣 {t.discount_percent}% · rank {t.rank}
                  {!t.is_active && <span className="text-gray-500 text-xs ml-2">停用</span>}
                </div>
              </div>
              <button
                disabled={busy}
                className="px-3 py-1.5 text-xs border border-white/10 rounded-xl"
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
                className="px-3 py-1.5 text-xs border border-white/10 rounded-xl"
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
              className="bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm"
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
              className="bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm"
            />
            <input
              type="number"
              required
              placeholder="美分"
              value={planForm.price_cents}
              onChange={(e) => setPlanForm({ ...planForm, price_cents: Number(e.target.value) })}
              className="bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm"
            />
            <input
              type="number"
              placeholder="赠点"
              value={planForm.bonus_credits}
              onChange={(e) =>
                setPlanForm({ ...planForm, bonus_credits: Number(e.target.value) })
              }
              className="bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm"
            />
            <input
              type="number"
              placeholder="天数"
              value={planForm.duration_days}
              onChange={(e) =>
                setPlanForm({ ...planForm, duration_days: Number(e.target.value) })
              }
              className="bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-2 text-sm font-semibold bg-rose-600 rounded-2xl disabled:opacity-50"
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
                  {!p.is_active && <span className="text-gray-500 text-xs ml-2">停用</span>}
                </div>
              </div>
              <button
                disabled={busy}
                className="px-3 py-1.5 text-xs border border-white/10 rounded-xl"
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
                className="px-3 py-1.5 text-xs border border-white/10 rounded-xl"
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
                className="px-3 py-1.5 text-xs border border-red-500/30 text-red-300 rounded-xl"
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
