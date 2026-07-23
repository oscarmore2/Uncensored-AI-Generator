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

export { ensurePricingSeeded } from "./pricing-seed";

export type ProductRow = GenerationProduct;
export type ParamMappingRow = ModeParamMapping;

export type GenerationQuoteInput = {
  mode: string;
  zenModel?: string | null;
  variantKey?: string | null;
  batch?: number;
  user?: Pick<User, "isVip" | "vipExpiresAt" | "vipTierId"> & {
    vipTier?: Pick<VipTier, "id" | "code" | "name" | "discountBps" | "isActive"> | null;
  };
};

export type GenerationQuote = {
  cost: number;
  baseCost: number;
  batch: number;
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

export async function resolveGenerationProduct(opts: {
  mode: string;
  zenModel?: string | null;
  variantKey?: string | null;
}): Promise<GenerationProduct> {
  await ensurePricingSeeded();
  const variantKey =
    opts.mode === "undress" ? (opts.variantKey?.trim() || "female") : (opts.variantKey ?? "");

  if (opts.zenModel?.trim()) {
    const exact = await db.generationProduct.findFirst({
      where: {
        mode: opts.mode,
        zenModel: opts.zenModel.trim(),
        variantKey,
        isActive: true,
      },
    });
    if (exact) return exact;
  }

  const preferred = await db.generationProduct.findFirst({
    where: { mode: opts.mode, variantKey, isActive: true },
    orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }, { id: "asc" }],
  });
  if (preferred) return preferred;

  const anyMode = await db.generationProduct.findFirst({
    where: { mode: opts.mode, isActive: true },
    orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }, { id: "asc" }],
  });
  if (anyMode) return anyMode;

  throw new Error(`未配置可用的生成产品：${opts.mode}`);
}

export async function resolveGenerationQuote(input: GenerationQuoteInput): Promise<GenerationQuote> {
  const product = await resolveGenerationProduct({
    mode: input.mode,
    zenModel: input.zenModel,
    variantKey: input.variantKey,
  });

  const batch = input.mode === "undress" ? 1 : (input.batch ?? 1);
  let cost = product.creditCost;
  const baseCost = product.creditCost;
  if (input.mode !== "undress" && batch === 4) {
    cost = Math.floor(product.creditCost * product.batchFourMultiplier);
  }

  let discountBps = 0;
  let tier: GenerationQuote["tier"] = null;

  if (input.user && isVipActive(input.user)) {
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

  return { cost, baseCost, batch, discountBps, product, tier };
}

/** UI 参数 → Zen input（不含 prompt / assets；model 强制来自产品） */
export async function buildZenInputFromMappings(
  mode: string,
  uiParams: Record<string, unknown>,
  product: GenerationProduct
): Promise<Record<string, unknown>> {
  await ensurePricingSeeded();
  const mappings = await db.modeParamMapping.findMany({
    where: { mode, enabled: true },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });

  const input: Record<string, unknown> = {};

  for (const m of mappings) {
    if (m.zenPath.startsWith("_")) continue; // 仅 UI / 本地用，不传 Zen
    const raw = uiParams[m.uiKey];
    if (raw === undefined || raw === null || raw === "") continue;
    const valueMap = parseJsonObject(m.valueMap);
    let value: unknown = raw;
    const key = String(raw);
    if (Object.prototype.hasOwnProperty.call(valueMap, key)) {
      value = valueMap[key];
    }
    input[m.zenPath] = value;
  }

  // 强制产品模型；脱衣工具不带 model 字段时仍可写（Zen undress 可忽略）
  if (mode !== "undress") {
    input.model = product.zenModel;
  }

  return input;
}

export async function listActiveCatalog() {
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
    products: products.map(productOut),
    param_mappings: mappings.map(mappingOut),
    credit_packages: packages.map(packageOut),
    vip_plans: plans
      .filter((p) => p.tier.isActive)
      .map((p) => ({
        ...planOut(p),
        tier: tierOut(p.tier),
      })),
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

export function productOut(p: GenerationProduct) {
  return {
    id: p.id,
    mode: p.mode,
    zen_tool: p.zenTool,
    zen_model: p.zenModel,
    variant_key: p.variantKey,
    label: p.label,
    credit_cost: p.creditCost,
    batch_four_multiplier: p.batchFourMultiplier,
    is_active: p.isActive,
    is_default: p.isDefault,
    sort_order: p.sortOrder,
  };
}

export function mappingOut(m: ModeParamMapping) {
  return {
    id: m.id,
    mode: m.mode,
    ui_key: m.uiKey,
    zen_path: m.zenPath,
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

/** 推导 magic-prompt formatId（与 zen-targets 对齐） */
export function formatIdForProduct(product: Pick<GenerationProduct, "mode" | "zenTool">): string {
  switch (product.mode) {
    case "txt2img":
      return "sdxl_t2i";
    case "img2img":
      return "sdxl_i2i";
    case "txt2vid":
      return "wan_t2v";
    case "img2vid":
      return "wan_i2v";
    case "undress":
      return "undress";
    default:
      return "sdxl_t2i";
  }
}
