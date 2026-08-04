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
 * 播种一律「只补不改」：只为缺失的档位 / 参数映射 / 充值档创建默认行，
 * 绝不删除、绝不覆盖管理端已经改过的价格、标签、上下架状态与模型绑定。
 *
 * 之前的实现会在版本号变化时 deleteMany 后按蓝图重建，
 * 结果每次部署都把运营在后台的改价、调倍率、停用、充值档配置重置一遍。
 * 现在改成幂等增量，因此不再需要版本号闸门——每次启动跑一遍也是安全的。
 */

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
  await ensureGenerationProducts();
  await ensureParamMappings();
  await ensureCreditPackages();
  await seedVipDefaults();
}

/* ------------------------------------------------ 档位补齐（只补不改） */

/**
 * 只为「蓝图里有、库里没有」的 (mode, tier, spicy) 组合创建默认行。
 * 已存在的行一概不动——管理端改过的价格 / 倍率 / 标签 / 上下架 / 模型绑定全部保留。
 */
async function ensureGenerationProducts(): Promise<void> {
  const existing = await db.generationProduct.findMany({
    select: { mode: true, tier: true, spicy: true },
  });
  const have = new Set(existing.map((p) => `${p.mode}:${p.tier}:${p.spicy}`));

  const blueprints = skuBlueprints();

  // 普通档价格先算好，Spicy 需要参照它保证严格更高
  const normalCost = new Map<string, number>();
  for (const bp of blueprints.filter((b) => !b.spicy)) {
    normalCost.set(`${bp.mode}:${bp.tier}`, deriveCreditCost(bp.refCredits, NORMAL_MULTIPLIER_BPS));
  }

  for (const bp of blueprints) {
    if (have.has(`${bp.mode}:${bp.tier}:${bp.spicy}`)) continue;

    const multiplierBps = bp.spicy ? SPICY_MULTIPLIER_BPS : NORMAL_MULTIPLIER_BPS;
    let creditCost = deriveCreditCost(bp.refCredits, multiplierBps);
    // 向上取整会让 ×1.3 与 ×1.5 在小数值上撞价，抬 1 点保住 Spicy 溢价
    const base = normalCost.get(`${bp.mode}:${bp.tier}`) ?? 1;
    if (bp.spicy && creditCost <= base) creditCost = base + 1;

    await db.generationProduct.create({
      data: {
        mode: bp.mode,
        tier: bp.tier,
        spicy: bp.spicy,
        provider: "wavespeed",
        providerModelId: "", // 桥接模型一律由管理端手工指定
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
  const catalog = await db.providerCatalogModel.findMany({
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

/**
 * 只补缺失的 (mode, uiKey) 映射行；已有的一概不动。
 * 之前是 deleteMany 后整表重建，运营改过的选项/开关会被清掉。
 */
async function ensureParamMappings(): Promise<void> {
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
  // 时长选项是并集；实际可选值以模型 schema 的 enum / 上下限为准
  const durationOpts = JSON.stringify([
    { value: "4", label: "4 秒" },
    { value: "5", label: "5 秒" },
    { value: "8", label: "8 秒" },
    { value: "10", label: "10 秒" },
    { value: "15", label: "15 秒" },
  ]);

  const formatOpts = JSON.stringify([
    { value: "jpeg", label: "JPEG（体积小）" },
    { value: "png", label: "PNG（无损）" },
    { value: "webp", label: "WebP" },
  ]);
  const videoResolutionOpts = JSON.stringify([
    { value: "480p", label: "480p" },
    { value: "720p", label: "720p" },
    { value: "1080p", label: "1080p" },
  ]);

  const IMAGE_MODES = ["txt2img", "img2img", "imgedit", "undress"] as const;
  const VIDEO_MODES = ["txt2vid", "img2vid"] as const;

  /**
   * 映射表按「所有模型的并集」配置，不必为每个模型单独维护：
   * 生成端会用绑定模型的 schema 过滤，模型不支持的字段既不显示也不发送。
   * 因此这里配得越全，换绑到功能更多的模型时可调项就越丰富。
   */
  const rows = [
    ...IMAGE_MODES.flatMap((mode) => [
      { mode, uiKey: "ratio", providerPath: "aspect_ratio", options: imageSizeOpts, sortOrder: 10 },
      { mode, uiKey: "size", providerPath: "size", options: null, sortOrder: 20 },
      { mode, uiKey: "format", providerPath: "output_format", options: formatOpts, sortOrder: 30 },
      { mode, uiKey: "steps", providerPath: "num_inference_steps", options: null, sortOrder: 40 },
      { mode, uiKey: "guidance", providerPath: "guidance_scale", options: null, sortOrder: 50 },
      { mode, uiKey: "strength", providerPath: "strength", options: null, sortOrder: 60 },
      { mode, uiKey: "seed", providerPath: "seed", options: null, sortOrder: 90 },
    ]),
    ...VIDEO_MODES.flatMap((mode) => [
      {
        mode,
        uiKey: "duration",
        providerPath: "duration",
        options: durationOpts,
        sortOrder: 10,
      },
      { mode, uiKey: "resolution", providerPath: "resolution", options: videoResolutionOpts, sortOrder: 20 },
      { mode, uiKey: "ratio", providerPath: "aspect_ratio", options: videoRatioOpts, sortOrder: 30 },
      { mode, uiKey: "audio", providerPath: "enable_audio", options: null, sortOrder: 40 },
      { mode, uiKey: "seed", providerPath: "seed", options: null, sortOrder: 90 },
    ]),
  ];

  const existing = await db.modeParamMapping.findMany({ select: { mode: true, uiKey: true } });
  const have = new Set(existing.map((m) => `${m.mode}:${m.uiKey}`));
  const missing = rows.filter((r) => !have.has(`${r.mode}:${r.uiKey}`));
  if (missing.length) {
    await db.modeParamMapping.createMany({ data: missing });
  }
}

/* ------------------------------------------------------------ 充值档 */

/**
 * 全新安装时的默认充值档：单点美元价与 ZenCreator Starter 对齐并细分 10 倍
 * （$19.99/2000 = $0.009995），生成扣点的 130% / 150% 才是真实倍率。
 */
const DEFAULT_CREDIT_PACKAGES = [
  { credits: 2000, priceCents: 1999, label: "入门包", badge: null as string | null, sortOrder: 10 },
  { credits: 5500, priceCents: 4999, label: "创作包", badge: "热门", sortOrder: 20 },
  { credits: 12000, priceCents: 9900, label: "达人包", badge: null, sortOrder: 30 },
  { credits: 63000, priceCents: 49900, label: "专业包", badge: "超值", sortOrder: 40 },
];

/**
 * 充值档只在「整张表为空」时播种一次，之后完全交给管理端。
 *
 * 旧实现会用 env.CREDIT_PACKAGES 覆盖写入、并把不在列表里的档位统统
 * isActive=false，导致每次部署都把运营在 /admin/pricing 配好的档位重置掉
 * （手工建的档被停用，同时冒出一批 "20 点" 这种通用标签的档）。
 * 现在部署不再碰已有数据；要改档位就在管理端改，那里是唯一事实来源。
 */
async function ensureCreditPackages(): Promise<void> {
  if ((await db.creditPackage.count()) > 0) return;

  // 仅首次安装：显式配了 CREDIT_PACKAGES 就按它建，否则用内置默认档
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
    : DEFAULT_CREDIT_PACKAGES;

  await db.creditPackage.createMany({
    data: target.map((p) => ({ ...p, isActive: true })),
    skipDuplicates: true,
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
