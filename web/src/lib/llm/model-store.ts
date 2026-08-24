import "server-only";
import { db } from "../db";
import { LLM_MODELS, LLM_TIERS, type LlmModelSpec, type LlmTier } from "./models";

/**
 * 模型注册表的读写。
 *
 * `models.ts` 里的常量从「运行时唯一真相」降级成**出厂值**：
 * 库里没有就按它建行，建完之后以库为准。这样上游涨价、要换模型、
 * 要调倍率，运营在管理端改一下就行，不用发版。
 *
 * 播种一律「只补不改」，与 `pricing-seed.ts` 同一条规矩：
 * 价格是运营数据，绝不能被一次部署重置回出厂值。
 */

type LlmModelRow = {
  key: string;
  label: string;
  provider: string;
  providerModelId: string;
  tierCode: string;
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  priceMultiplierBps: number;
  contextTokens: number;
  supportsStreaming: boolean;
  uncensored: boolean;
  requiresVipRank: number;
  requiresAdult: boolean;
};

export function specFromRow(row: LlmModelRow): LlmModelSpec {
  return {
    key: row.key,
    label: row.label,
    tierCode: row.tierCode as LlmTier,
    openRouterModelId: row.providerModelId,
    inputUsdPerMTok: row.inputUsdPerMTok,
    outputUsdPerMTok: row.outputUsdPerMTok,
    priceMultiplierBps: row.priceMultiplierBps,
    contextTokens: row.contextTokens,
    supportsStreaming: row.supportsStreaming,
    uncensored: row.uncensored,
    requiresVipRank: row.requiresVipRank,
    requiresAdult: row.requiresAdult,
  };
}

let seeding = false;
let seeded = false;

export async function ensureLlmModelsSeeded(): Promise<void> {
  if (seeded) return;
  if (seeding) {
    while (seeding) await new Promise((r) => setTimeout(r, 20));
    return;
  }
  seeding = true;
  try {
    for (const tier of LLM_TIERS) {
      const spec = LLM_MODELS[tier];
      // 只 create，不 update：管理端改过的价格、倍率、上下架一概不动
      await db.llmModel.upsert({
        where: { key: spec.key },
        update: {},
        create: {
          key: spec.key,
          label: spec.label,
          provider: "openrouter",
          providerModelId: spec.openRouterModelId,
          tierCode: spec.tierCode,
          inputUsdPerMTok: spec.inputUsdPerMTok,
          outputUsdPerMTok: spec.outputUsdPerMTok,
          priceMultiplierBps: spec.priceMultiplierBps,
          contextTokens: spec.contextTokens,
          supportsStreaming: spec.supportsStreaming,
          uncensored: spec.uncensored,
          requiresVipRank: spec.requiresVipRank,
          requiresAdult: spec.requiresAdult,
          sortOrder: LLM_TIERS.indexOf(tier) * 10,
        },
      });
    }
    seeded = true;
  } catch (err) {
    // 库还没迁移完 / 连不上时不该把改写功能一起拖垮，下面会退回常量
    console.error("[llm-model-store] seed failed:", err);
  } finally {
    seeding = false;
  }
}

/**
 * 取该档位当前启用的模型。
 *
 * 库里查不到就用出厂常量——**这条兜底不是可有可无的**：
 * 迁移还没跑完、或者运营手滑把一个档位全停用了，改写功能都不该整个消失。
 */
export async function resolveLlmModel(tier: LlmTier): Promise<LlmModelSpec> {
  try {
    await ensureLlmModelsSeeded();
    const row = await db.llmModel.findFirst({
      where: { tierCode: tier, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    });
    if (row) return specFromRow(row);
  } catch (err) {
    console.error("[llm-model-store] resolve failed, using built-in defaults:", err);
  }
  return LLM_MODELS[tier];
}
