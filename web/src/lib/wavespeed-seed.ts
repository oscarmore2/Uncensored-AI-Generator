import "server-only";
import { db } from "./db";

/**
 * 首期默认预上架的一批 WaveSpeed 模型。
 * 只针对 WaveSpeed：这些 model_id 是它家独有的，Atlas 的货架完全由管理端手工上架。
 */
const PROVIDER = "wavespeed";

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
 * 首次同步 catalog 后铺一批默认上架产品，返回新建数量。
 *
 * 只在「货架整张表为空」时播种：否则管理端主动下架 / 删掉的默认产品
 * 会在每次点同步时被重新创建出来（连 isActive、isRecommended 一起复活），
 * 这也是一种配置被重置。货架内容之后完全以管理端为准。
 */
export async function ensureDefaultPlaythingProducts(): Promise<number> {
  if ((await db.playthingProduct.count()) > 0) return 0;

  let created = 0;

  for (const item of DEFAULT_SHELF) {
    const catalog = await db.providerCatalogModel.findUnique({
      where: { provider_modelId: { provider: PROVIDER, modelId: item.modelId } },
    });
    if (!catalog) continue;
    const existing = await db.playthingProduct.findUnique({
      where: { provider_modelId: { provider: PROVIDER, modelId: item.modelId } },
    });
    if (existing) continue;
    await db.playthingProduct.create({
      data: {
        provider: PROVIDER,
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
  const spicyCandidates = await db.providerCatalogModel.findMany({
    where: {
      provider: PROVIDER,
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
    const existing = await db.playthingProduct.findUnique({
      where: { provider_modelId: { provider: PROVIDER, modelId: spicy.modelId } },
    });
    if (!existing) {
      await db.playthingProduct.create({
        data: {
          provider: PROVIDER,
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
