import "server-only";
import type {
  CreditPackage,
  GenerationProduct,
  ModeParamMapping,
  User,
  VipPlan,
  VipTier,
} from "@prisma/client";
import { db } from "./db";
import { ensurePricingSeeded } from "./pricing-seed";
import {
  MODE_META,
  durationMultiplier,
  isGenerationMode,
  isGenerationTier,
  type GenerationTier,
} from "./generation-modes";
import { ZC_STARTER_USD_PER_CREDIT, effectiveMultiplierBps } from "./generation-catalog";

export { ensurePricingSeeded } from "./pricing-seed";

export type ProductRow = GenerationProduct;
export type ParamMappingRow = ModeParamMapping;

export class SpicyRequiresVipError extends Error {
  code = "SPICY_REQUIRES_VIP" as const;
  constructor() {
    super("Spicy 档为会员专属，请先开通会员");
  }
}

export type GenerationQuoteInput = {
  mode: string;
  tier?: string | null;
  spicy?: boolean;
  batch?: number;
  /** 视频时长（秒）；按 ceil(duration / unitSeconds) 倍率计费 */
  durationSeconds?: number | null;
  user?: Pick<User, "isVip" | "vipExpiresAt" | "vipTierId"> & {
    vipTier?: Pick<VipTier, "id" | "code" | "name" | "discountBps" | "isActive"> | null;
  };
};

export type GenerationQuote = {
  cost: number;
  baseCost: number;
  batch: number;
  durationUnits: number;
  discountBps: number;
  product: GenerationProduct;
  tier: Pick<VipTier, "id" | "code" | "name" | "discountBps"> | null;
};

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function parseJsonArray(raw: string | null | undefined): Array<{ value: string; label: string }> {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const o = item as { value?: unknown; label?: unknown };
        if (typeof o.value !== "string") return null;
        return { value: o.value, label: typeof o.label === "string" ? o.label : o.value };
      })
      .filter(Boolean) as Array<{ value: string; label: string }>;
  } catch {
    return [];
  }
}

export function isVipActive(
  user: Pick<User, "isVip" | "vipExpiresAt"> | null | undefined
): boolean {
  if (!user?.isVip) return false;
  if (!user.vipExpiresAt) return true;
  return user.vipExpiresAt.getTime() > Date.now();
}

/** 该模式下默认档位：优先 isDefault，其次最低档 */
function fallbackTier(mode: string): GenerationTier {
  const meta = isGenerationMode(mode) ? MODE_META[mode] : null;
  return (meta?.tiers[0] ?? "low") as GenerationTier;
}

export async function resolveGenerationProduct(opts: {
  mode: string;
  tier?: string | null;
  spicy?: boolean;
}): Promise<GenerationProduct> {
  await ensurePricingSeeded();
  const spicy = Boolean(opts.spicy);
  const tier = isGenerationTier(opts.tier) ? opts.tier : fallbackTier(opts.mode);

  const exact = await db.generationProduct.findFirst({
    where: { mode: opts.mode, tier, spicy, isActive: true },
  });
  if (exact) return exact;

  // 档位被下架时退回同 spicy 属性下的默认档，避免整个模式不可用
  const sameFlavor = await db.generationProduct.findFirst({
    where: { mode: opts.mode, spicy, isActive: true },
    orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }, { id: "asc" }],
  });
  if (sameFlavor) return sameFlavor;

  if (spicy) throw new Error(`未配置可用的 Spicy 档位：${opts.mode}`);

  const anyMode = await db.generationProduct.findFirst({
    where: { mode: opts.mode, isActive: true, spicy: false },
    orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }, { id: "asc" }],
  });
  if (anyMode) return anyMode;

  throw new Error(`未配置可用的生成产品：${opts.mode}`);
}

export async function resolveGenerationQuote(input: GenerationQuoteInput): Promise<GenerationQuote> {
  const product = await resolveGenerationProduct({
    mode: input.mode,
    tier: input.tier,
    spicy: input.spicy,
  });

  const vipActive = input.user ? isVipActive(input.user) : false;
  if (product.requiresVip && !vipActive) throw new SpicyRequiresVipError();

  const meta = isGenerationMode(product.mode) ? MODE_META[product.mode] : null;
  const batch = meta?.supportsBatch ? (input.batch ?? 1) : 1;
  const durationUnits =
    product.unitSeconds > 0
      ? durationMultiplier(Number(input.durationSeconds ?? product.unitSeconds), product.unitSeconds)
      : 1;

  const baseCost = product.creditCost;
  let cost = baseCost * durationUnits;
  if (batch === 4) cost = Math.floor(cost * product.batchFourMultiplier);
  else if (batch === 2) cost = cost * 2;

  let discountBps = 0;
  let tier: GenerationQuote["tier"] = null;

  if (input.user && vipActive) {
    let vipTier = input.user.vipTier ?? null;
    if (!vipTier && input.user.vipTierId) {
      vipTier = await db.vipTier.findFirst({
        where: { id: input.user.vipTierId, isActive: true },
        select: { id: true, code: true, name: true, discountBps: true, isActive: true },
      });
    }
    if (vipTier?.isActive && vipTier.discountBps > 0) {
      discountBps = Math.min(10000, Math.max(0, vipTier.discountBps));
      cost = Math.max(1, Math.floor((cost * (10000 - discountBps)) / 10000));
    }
    if (vipTier) {
      tier = {
        id: vipTier.id,
        code: vipTier.code,
        name: vipTier.name,
        discountBps: vipTier.discountBps,
      };
    }
  }

  return { cost: Math.max(1, cost), baseCost, batch, durationUnits, discountBps, product, tier };
}

/**
 * 生成端可见目录。
 * 刻意不返回 provider / providerModelId：生成端不得知道底层模型。
 */
export async function listActiveCatalog(opts?: { vipActive?: boolean }) {
  await ensurePricingSeeded();
  const [products, mappings, packages, plans] = await Promise.all([
    db.generationProduct.findMany({
      where: { isActive: true },
      orderBy: [{ mode: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
    }),
    db.modeParamMapping.findMany({
      where: { enabled: true },
      orderBy: [{ mode: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
    }),
    db.creditPackage.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { credits: "asc" }],
    }),
    db.vipPlan.findMany({
      where: { isActive: true },
      include: { tier: true },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    }),
  ]);

  return {
    // 未绑定模型的档位对用户隐藏，避免点了必然失败
    products: products.filter((p) => p.providerModelId.trim() !== "").map(productOut),
    param_mappings: mappings.map(mappingOut),
    credit_packages: packages.map(packageOut),
    vip_plans: plans
      .filter((p) => p.tier.isActive)
      .map((p) => ({ ...planOut(p), tier: tierOut(p.tier) })),
    vip_active: Boolean(opts?.vipActive),
  };
}

export async function getCreditPackageByCredits(credits: number): Promise<CreditPackage | null> {
  await ensurePricingSeeded();
  return db.creditPackage.findFirst({ where: { credits, isActive: true } });
}

export async function getDefaultVipPlan(): Promise<(VipPlan & { tier: VipTier }) | null> {
  await ensurePricingSeeded();
  return db.vipPlan.findFirst({
    where: { isActive: true, tier: { isActive: true } },
    include: { tier: true },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
}

export async function getVipPlanById(id: number): Promise<(VipPlan & { tier: VipTier }) | null> {
  await ensurePricingSeeded();
  return db.vipPlan.findFirst({
    where: { id, isActive: true, tier: { isActive: true } },
    include: { tier: true },
  });
}

/** 生成端视图：不含任何上游模型信息 */
export function productOut(p: GenerationProduct) {
  return {
    id: p.id,
    mode: p.mode,
    tier: p.tier,
    spicy: p.spicy,
    label: p.label,
    description: p.description,
    credit_cost: p.creditCost,
    batch_four_multiplier: p.batchFourMultiplier,
    unit_seconds: p.unitSeconds,
    requires_vip: p.requiresVip,
    is_default: p.isDefault,
    sort_order: p.sortOrder,
  };
}

/** 管理端视图：包含桥接模型与计价溯源 */
export function productAdminOut(p: GenerationProduct) {
  return {
    ...productOut(p),
    provider: p.provider,
    provider_model_id: p.providerModelId,
    is_bound: p.providerModelId.trim() !== "",
    is_active: p.isActive,
    ref_credits: p.refCredits,
    ref_label: p.refLabel,
    price_multiplier_bps: p.priceMultiplierBps,
    effective_multiplier_bps: effectiveMultiplierBps(p.refCredits, p.creditCost),
    default_inputs: parseJsonObject(p.defaultInputs),
    /** 该档位一次生成的站内售价（美元），用于对照上游成本算毛利 */
    retail_usd: Number((p.creditCost * ZC_STARTER_USD_PER_CREDIT).toFixed(4)),
  };
}

export function mappingOut(m: ModeParamMapping) {
  return {
    id: m.id,
    mode: m.mode,
    ui_key: m.uiKey,
    provider_path: m.providerPath,
    value_map: parseJsonObject(m.valueMap),
    options: parseJsonArray(m.options),
    enabled: m.enabled,
    sort_order: m.sortOrder,
  };
}

export function packageOut(p: CreditPackage) {
  return {
    id: p.id,
    credits: p.credits,
    price_cents: p.priceCents,
    label: p.label,
    badge: p.badge,
    is_active: p.isActive,
    sort_order: p.sortOrder,
  };
}

export function tierOut(t: VipTier) {
  return {
    id: t.id,
    code: t.code,
    name: t.name,
    rank: t.rank,
    discount_bps: t.discountBps,
    discount_percent: t.discountBps / 100,
    plaything_access: t.playthingAccess,
    is_active: t.isActive,
  };
}

export function planOut(p: VipPlan) {
  return {
    id: p.id,
    tier_id: p.tierId,
    label: p.label,
    price_cents: p.priceCents,
    bonus_credits: p.bonusCredits,
    duration_days: p.durationDays,
    is_active: p.isActive,
    sort_order: p.sortOrder,
  };
}
