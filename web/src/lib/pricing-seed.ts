import "server-only";
import { db } from "./db";
import { env } from "./env";

let seeding = false;
let seeded = false;

/** 表为空时写入与现状对齐的默认价格/映射/VIP；幂等 */
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
  const [productCount, packageCount, tierCount, mappingCount] = await Promise.all([
    db.generationProduct.count(),
    db.creditPackage.count(),
    db.vipTier.count(),
    db.modeParamMapping.count(),
  ]);

  if (productCount === 0) {
    await db.generationProduct.createMany({
      data: [
        {
          mode: "txt2img",
          zenTool: "by_prompt",
          zenModel: "SDXL_NSFW",
          variantKey: "",
          label: "文生图 · SDXL NSFW",
          creditCost: 2,
          isDefault: true,
          sortOrder: 10,
        },
        {
          mode: "txt2img",
          zenTool: "by_prompt",
          zenModel: "GENERAL_NSFW",
          variantKey: "",
          label: "文生图 · GENERAL NSFW",
          creditCost: 2,
          isDefault: false,
          sortOrder: 20,
        },
        {
          mode: "img2img",
          zenTool: "image_editor",
          zenModel: "SDXL_NSFW",
          variantKey: "",
          label: "图生图 · SDXL NSFW",
          creditCost: 3,
          isDefault: true,
          sortOrder: 10,
        },
        {
          mode: "txt2vid",
          zenTool: "text_to_video",
          zenModel: "wan@2.7-nsfw",
          variantKey: "",
          label: "文生视频 · Wan 2.7 NSFW",
          creditCost: 15,
          isDefault: true,
          sortOrder: 10,
        },
        {
          mode: "txt2vid",
          zenTool: "text_to_video",
          zenModel: "seedance_2_0",
          variantKey: "",
          label: "文生视频 · Seedance 2.0",
          creditCost: 15,
          isDefault: false,
          sortOrder: 20,
        },
        {
          mode: "img2vid",
          zenTool: "videogen",
          zenModel: "wan@2.7-nsfw",
          variantKey: "",
          label: "图生视频 · Wan 2.7 NSFW",
          creditCost: 20,
          isDefault: true,
          sortOrder: 10,
        },
        {
          mode: "undress",
          zenTool: "undress",
          zenModel: "undress",
          variantKey: "female",
          label: "一键脱衣 · 女",
          creditCost: 4,
          batchFourMultiplier: 1,
          isDefault: true,
          sortOrder: 10,
        },
        {
          mode: "undress",
          zenTool: "male_undresser",
          zenModel: "male_undresser",
          variantKey: "male",
          label: "一键脱衣 · 男",
          creditCost: 4,
          batchFourMultiplier: 1,
          isDefault: false,
          sortOrder: 20,
        },
        {
          mode: "undress",
          zenTool: "couple_undresser",
          zenModel: "couple_undresser",
          variantKey: "couple",
          label: "一键脱衣 · 情侣",
          creditCost: 4,
          batchFourMultiplier: 1,
          isDefault: false,
          sortOrder: 30,
        },
      ],
    });
  }

  if (mappingCount === 0) {
    const ratioOpts = JSON.stringify([
      { value: "1:1", label: "1:1 正方形" },
      { value: "16:9", label: "16:9 横向" },
      { value: "9:16", label: "9:16 纵向" },
      { value: "4:3", label: "4:3" },
    ]);
    const qualityOpts = JSON.stringify([
      { value: "fast", label: "快速 (低成本)" },
      { value: "quality", label: "高质量" },
    ]);
    const styleOpts = JSON.stringify([
      { value: "realistic", label: "写实风格" },
      { value: "asian", label: "亚洲写实" },
      { value: "anime", label: "动漫风格" },
      { value: "cinematic", label: "电影感" },
    ]);
    const durationOpts = JSON.stringify([
      { value: "4", label: "4 秒" },
      { value: "5", label: "5 秒" },
    ]);
    const resolutionOpts = JSON.stringify([
      { value: "1280x720", label: "1280×720" },
      { value: "720x1280", label: "720×1280" },
    ]);

    await db.modeParamMapping.createMany({
      data: [
        { mode: "txt2img", uiKey: "ratio", zenPath: "ratio", options: ratioOpts, sortOrder: 10 },
        { mode: "txt2img", uiKey: "quality", zenPath: "mode", options: qualityOpts, sortOrder: 20 },
        { mode: "txt2img", uiKey: "style", zenPath: "_style", options: styleOpts, sortOrder: 30 },
        { mode: "img2img", uiKey: "ratio", zenPath: "ratio", options: ratioOpts, sortOrder: 10 },
        { mode: "img2img", uiKey: "style", zenPath: "_style", options: styleOpts, sortOrder: 20 },
        {
          mode: "txt2vid",
          uiKey: "duration",
          zenPath: "duration",
          options: durationOpts,
          valueMap: JSON.stringify({ "4": 4, "5": 5 }),
          sortOrder: 10,
        },
        {
          mode: "txt2vid",
          uiKey: "resolution",
          zenPath: "resolution",
          options: resolutionOpts,
          sortOrder: 20,
        },
        {
          mode: "img2vid",
          uiKey: "duration",
          zenPath: "duration",
          options: durationOpts,
          valueMap: JSON.stringify({ "4": 4, "5": 5 }),
          sortOrder: 10,
        },
      ],
    });
  }

  if (packageCount === 0) {
    const fromEnv = Object.entries(env.CREDIT_PACKAGES).map(([credits, priceCents], i) => ({
      credits: Number(credits),
      priceCents,
      label:
        Number(credits) <= 100
          ? "基础包"
          : Number(credits) <= 500
            ? "进阶包"
            : Number(credits) <= 1200
              ? "豪华包"
              : "至尊包",
      badge: Number(credits) === 500 ? "热门" : null,
      sortOrder: (i + 1) * 10,
      isActive: true,
    }));
    if (fromEnv.length > 0) {
      await db.creditPackage.createMany({ data: fromEnv });
    }
  }

  if (tierCount === 0) {
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
        bonusCredits: 800,
        durationDays: 30,
        isActive: true,
        sortOrder: 10,
      },
    });
  }
}
