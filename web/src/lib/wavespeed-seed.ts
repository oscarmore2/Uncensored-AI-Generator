import "server-only";
import { db } from "./db";

/** 首期默认预上架（同步后若不存在 Product 则创建） */
const DEFAULT_SHELF: Array<{
  modelId: string;
  label: string;
  creditCost: number;
  sortOrder: number;
  isRecommended: boolean;
  match?: RegExp;
}> = [
  {
    modelId: "wavespeed-ai/chroma",
    label: "Chroma",
    creditCost: 8,
    sortOrder: 10,
    isRecommended: true,
  },
  {
    modelId: "wavespeed-ai/ai-breast-expansion",
    label: "丰乳特效",
    creditCost: 10,
    sortOrder: 20,
    isRecommended: true,
  },
  {
    modelId: "wavespeed-ai/infinite-you",
    label: "Infinite You",
    creditCost: 12,
    sortOrder: 30,
    isRecommended: true,
  },
];

/**
 * 在 catalog 已同步后，确保推荐模型有 Product。
 * Seedance Spicy I2V：按关键词在 catalog 中解析真实 model_id。
 * 返回新创建的 Product 数量。
 */
export async function ensureDefaultPlaythingProducts(): Promise<number> {
  let created = 0;

  for (const item of DEFAULT_SHELF) {
    const catalog = await db.waveSpeedCatalogModel.findUnique({ where: { modelId: item.modelId } });
    if (!catalog) continue;
    const existing = await db.waveSpeedProduct.findUnique({ where: { modelId: item.modelId } });
    if (existing) continue;
    await db.waveSpeedProduct.create({
      data: {
        modelId: item.modelId,
        catalogModelId: catalog.id,
        label: item.label,
        creditCost: item.creditCost,
        isActive: true,
        isRecommended: item.isRecommended,
        sortOrder: item.sortOrder,
      },
    });
    created += 1;
  }

  // Seedance Spicy I2V：从 catalog 找 spicy + seedance / i2v
  const spicyCandidates = await db.waveSpeedCatalogModel.findMany({
    where: {
      OR: [
        { modelId: { contains: "seedance", mode: "insensitive" } },
        { name: { contains: "seedance", mode: "insensitive" } },
      ],
    },
    take: 50,
  });
  const spicy =
    spicyCandidates.find(
      (c) =>
        /spicy/i.test(c.modelId) &&
        (/i2v|image-to-video|img2vid/i.test(c.modelId) || /i2v|image.to.video/i.test(c.type))
    ) ||
    spicyCandidates.find((c) => /spicy/i.test(c.modelId)) ||
    null;

  if (spicy) {
    const existing = await db.waveSpeedProduct.findUnique({ where: { modelId: spicy.modelId } });
    if (!existing) {
      await db.waveSpeedProduct.create({
        data: {
          modelId: spicy.modelId,
          catalogModelId: spicy.id,
          label: spicy.name.includes("Seedance") ? spicy.name : `Seedance Spicy · ${spicy.name}`,
          creditCost: 25,
          isActive: true,
          isRecommended: true,
          sortOrder: 40,
        },
      });
      created += 1;
    }
  }

  return created;
}
