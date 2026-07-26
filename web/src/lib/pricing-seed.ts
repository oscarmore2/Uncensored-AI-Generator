import "server-only";
import { db } from "./db";
import { env } from "./env";
import {
  NORMAL_MULTIPLIER_BPS,
  SPICY_MULTIPLIER_BPS,
  deriveCreditCost,
  skuBlueprints,
  type SkuBlueprint,
} from "./generation-catalog";

/**
 * 播种版本：改动 SKU 结构或对标价时 +1，会重建 GenerationProduct / ModeParamMapping。
 * 重建只覆盖档位与价格；管理端手工绑定的模型按 mode+tier+spicy 原样保留。
 */
const CATALOG_SEED_VERSION = "4";
const SEED_VERSION_KEY = "generation_catalog_seed_version";

let seeding = false;
let seeded = false;

export async function ensurePricingSeeded(): Promise<void> {
  if (seeded) return;
  if (seeding) {
    while (seeding) await new Promise((r) => setTimeout(r, 20));
    return;
  }
  seeding = true;
  try {
    await seedPricingOnce();
    seeded = true;
  } finally {
    seeding = false;
  }
}

async function seedPricingOnce(): Promise<void> {
  const current = await db.appSetting.findUnique({ where: { key: SEED_VERSION_KEY } });
  if (current?.value !== CATALOG_SEED_VERSION) {
    await rebuildGenerationCatalog();
    await seedCreditPackages();
    await db.appSetting.upsert({
      where: { key: SEED_VERSION_KEY },
      create: { key: SEED_VERSION_KEY, value: CATALOG_SEED_VERSION },
      update: { value: CATALOG_SEED_VERSION },
    });
  }
  await seedVipDefaults();
}

/* ------------------------------------------------------------ SKU 重建 */

/**
 * 重建 26 个档位 SKU。
 * 旧表结构里的产品（zenTool/zenModel 时代）与新档位无法一一对应，直接清空重来；
 * Generation 只用 productId 软引用，不存在外键，清空是安全的。
 */
async function rebuildGenerationCatalog(): Promise<void> {
  // 保住管理端已经手工换绑过的模型，重建后按 mode+tier+spicy 回填
  const previous = await db.generationProduct.findMany({
    select: { mode: true, tier: true, spicy: true, providerModelId: true },
  });
  const previousBindings = new Map(
    previous
      .filter((p) => p.providerModelId?.trim())
      .map((p) => [`${p.mode}:${p.tier}:${p.spicy}`, p.providerModelId])
  );

  await db.generationProduct.deleteMany({});

  const blueprints = skuBlueprints();
  const costByKey = new Map<string, number>();

  // 先算普通档，Spicy 需要参照它保证价格严格更高
  for (const bp of blueprints.filter((b) => !b.spicy)) {
    costByKey.set(
      `${bp.mode}:${bp.tier}`,
      deriveCreditCost(bp.refCredits, NORMAL_MULTIPLIER_BPS)
    );
  }

  for (const bp of blueprints) {
    const normalCost = costByKey.get(`${bp.mode}:${bp.tier}`) ?? 1;
    const multiplierBps = bp.spicy ? SPICY_MULTIPLIER_BPS : NORMAL_MULTIPLIER_BPS;
    let creditCost = deriveCreditCost(bp.refCredits, multiplierBps);
    // 向上取整会让 ×1.3 与 ×1.5 在小数值上撞价，抬 1 点保住 Spicy 溢价
    if (bp.spicy && creditCost <= normalCost) creditCost = normalCost + 1;

    await db.generationProduct.create({
      data: {
        mode: bp.mode,
        tier: bp.tier,
        spicy: bp.spicy,
        provider: "wavespeed",
        providerModelId: previousBindings.get(`${bp.mode}:${bp.tier}:${bp.spicy}`) ?? "",
        label: bp.label,
        description: bp.description,
        creditCost,
        refCredits: bp.refCredits,
        refLabel: bp.refLabel,
        priceMultiplierBps: multiplierBps,
        unitSeconds: bp.unitSeconds,
        requiresVip: bp.spicy,
        defaultInputs: JSON.stringify(bp.defaultInputs),
        isActive: true,
        isDefault: bp.isDefault,
        sortOrder: bp.sortOrder,
      },
    });
  }

  await rebuildParamMappings();
}

/* ---------------------------------------------------- 模型绑定解析 */

function matchBlueprint(
  bp: SkuBlueprint,
  catalog: Array<{ modelId: string; name: string; type: string }>
): string | null {
  for (const id of bp.modelCandidates) {
    if (catalog.some((c) => c.modelId === id)) return id;
  }
  if (bp.modelPattern) {
    const hit = catalog.find(
      (c) => bp.modelPattern!.test(c.modelId) || bp.modelPattern!.test(c.name)
    );
    if (hit) return hit.modelId;
  }
  return null;
}

/**
 * 按蓝图候选表填补「尚未绑定」的档位，永不覆盖已绑定的模型。
 * 仅由管理端「按候选表填充」按钮显式触发 —— 默认走人工绑定，
 * 播种与目录同步都不会自动改动绑定关系。
 */
export async function rebindGenerationProducts(): Promise<{ bound: number; unbound: number }> {
  const catalog = await db.waveSpeedCatalogModel.findMany({
    select: { modelId: true, name: true, type: true },
  });

  let bound = 0;
  let unbound = 0;

  for (const bp of skuBlueprints()) {
    const product = await db.generationProduct.findUnique({
      where: { mode_tier_spicy: { mode: bp.mode, tier: bp.tier, spicy: bp.spicy } },
    });
    if (!product) continue;
    if (product.providerModelId.trim()) {
      bound += 1;
      continue;
    }
    const modelId = matchBlueprint(bp, catalog);
    if (modelId) {
      await db.generationProduct.update({
        where: { id: product.id },
        data: { providerModelId: modelId },
      });
      bound += 1;
    } else {
      unbound += 1;
    }
  }

  return { bound, unbound };
}

/* --------------------------------------------------------- 参数映射 */

async function rebuildParamMappings(): Promise<void> {
  await db.modeParamMapping.deleteMany({});

  const imageSizeOpts = JSON.stringify([
    { value: "1:1", label: "1:1 正方形" },
    { value: "16:9", label: "16:9 横向" },
    { value: "9:16", label: "9:16 竖向" },
    { value: "4:3", label: "4:3" },
    { value: "3:4", label: "3:4" },
  ]);
  const videoRatioOpts = JSON.stringify([
    { value: "16:9", label: "16:9 横向" },
    { value: "9:16", label: "9:16 竖向" },
    { value: "1:1", label: "1:1 正方形" },
  ]);
  const durationOpts = JSON.stringify([
    { value: "5", label: "5 秒" },
    { value: "10", label: "10 秒（×2 计费）" },
  ]);

  const durationMap = JSON.stringify({ "5": 5, "10": 10 });

  await db.modeParamMapping.createMany({
    data: [
      // 图片：宽高比走 aspect_ratio，分辨率由档位的 defaultInputs 固定
      { mode: "txt2img", uiKey: "ratio", providerPath: "aspect_ratio", options: imageSizeOpts, sortOrder: 10 },
      { mode: "img2img", uiKey: "ratio", providerPath: "aspect_ratio", options: imageSizeOpts, sortOrder: 10 },
      { mode: "imgedit", uiKey: "ratio", providerPath: "aspect_ratio", options: imageSizeOpts, sortOrder: 10 },
      // 视频：时长影响计费，宽高比不影响
      {
        mode: "txt2vid",
        uiKey: "duration",
        providerPath: "duration",
        options: durationOpts,
        valueMap: durationMap,
        sortOrder: 10,
      },
      { mode: "txt2vid", uiKey: "ratio", providerPath: "aspect_ratio", options: videoRatioOpts, sortOrder: 20 },
      {
        mode: "img2vid",
        uiKey: "duration",
        providerPath: "duration",
        options: durationOpts,
        valueMap: durationMap,
        sortOrder: 10,
      },
      { mode: "img2vid", uiKey: "ratio", providerPath: "aspect_ratio", options: videoRatioOpts, sortOrder: 20 },
    ],
  });
}

/* ------------------------------------------------------------ 充值档 */

/**
 * 充值档与 ZenCreator 对齐后再细分 10 倍：单点美元价与 ZC Starter 完全一致
 * （$19.99/2000 = $0.009995），生成扣点的 130% / 150% 才是真实倍率。
 */
const ZC_ALIGNED_PACKAGES = [
  { credits: 2000, priceCents: 1999, label: "入门包", badge: null as string | null, sortOrder: 10 },
  { credits: 5500, priceCents: 4999, label: "创作包", badge: "热门", sortOrder: 20 },
  { credits: 12000, priceCents: 9900, label: "达人包", badge: null, sortOrder: 30 },
  { credits: 63000, priceCents: 49900, label: "专业包", badge: "超值", sortOrder: 40 },
];

async function seedCreditPackages(): Promise<void> {
  // 显式配置了 CREDIT_PACKAGES 时以环境变量为准，不覆盖运营的手工定价
  const fromEnv = Object.entries(env.CREDIT_PACKAGES);
  const useEnv = Boolean(process.env.CREDIT_PACKAGES) && fromEnv.length > 0;

  const target = useEnv
    ? fromEnv.map(([credits, priceCents], i) => ({
        credits: Number(credits),
        priceCents,
        label: `${credits} 点`,
        badge: null as string | null,
        sortOrder: (i + 1) * 10,
      }))
    : ZC_ALIGNED_PACKAGES;

  for (const p of target) {
    await db.creditPackage.upsert({
      where: { credits: p.credits },
      create: { ...p, isActive: true },
      update: {
        priceCents: p.priceCents,
        label: p.label,
        badge: p.badge,
        sortOrder: p.sortOrder,
        isActive: true,
      },
    });
  }

  // 不在新档位里的旧套餐下架，但保留记录以免影响历史订单
  await db.creditPackage.updateMany({
    where: { credits: { notIn: target.map((p) => p.credits) } },
    data: { isActive: false },
  });
}

/* --------------------------------------------------------------- VIP */

async function seedVipDefaults(): Promise<void> {
  if ((await db.vipTier.count()) > 0) return;

  const vip1 = await db.vipTier.create({
    data: { code: "vip1", name: "VIP1", rank: 1, discountBps: 0, isActive: true },
  });
  await db.vipTier.create({
    data: { code: "vip2", name: "VIP2", rank: 2, discountBps: 1000, isActive: true },
  });
  await db.vipPlan.create({
    data: {
      tierId: vip1.id,
      label: "VIP 月卡",
      priceCents: env.VIP_PRICE,
      bonusCredits: 8000,
      durationDays: 30,
      isActive: true,
      sortOrder: 10,
    },
  });
}
