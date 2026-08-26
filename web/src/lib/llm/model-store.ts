import "server-only";
import { db } from "../db";
import { LLM_MODELS, LLM_TIERS, pickTier, type LlmModelSpec, type LlmTier } from "./models";

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
  supportsVision: boolean;
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
    supportsVision: row.supportsVision,
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
          supportsVision: spec.supportsVision,
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
export const AUTO_MODEL_KEY = "auto";

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

/** 用户能不能用这个模型。两道门：VIP 等级、成人验证 */
export function canUseModel(
  model: Pick<LlmModelSpec, "requiresVipRank" | "requiresAdult">,
  opts: { vipRank: number; adultAccess: boolean }
): boolean {
  if (model.requiresVipRank > opts.vipRank) return false;
  if (model.requiresAdult && !opts.adultAccess) return false;
  return true;
}

/** 库里所有启用的模型，按档位排。给管理端与用户的模型选择器 */
export async function listLlmModels(): Promise<LlmModelSpec[]> {
  try {
    await ensureLlmModelsSeeded();
    const rows = await db.llmModel.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    });
    if (rows.length > 0) return rows.map(specFromRow);
  } catch (err) {
    console.error("[llm-model-store] list failed, using built-in defaults:", err);
  }
  return LLM_TIERS.map((t) => LLM_MODELS[t]);
}

/** 按 key 取一个模型。取不到返回 null，由调用方决定退回 auto 还是拒掉 */
export async function getLlmModelByKey(key: string): Promise<LlmModelSpec | null> {
  if (!key || key === AUTO_MODEL_KEY) return null;
  try {
    await ensureLlmModelsSeeded();
    const row = await db.llmModel.findFirst({ where: { key, isActive: true } });
    if (row) return specFromRow(row);
  } catch (err) {
    console.error("[llm-model-store] get by key failed:", err);
  }
  return Object.values(LLM_MODELS).find((m) => m.key === key) ?? null;
}

/**
 * 技能实际要用哪个模型。
 *
 * `modelKey === "auto"` 走按成人模式自动选档，与从前一致。绑了固定模型就用那个，
 * **但有一条例外**：成人模式下遇到会拒答的模型，仍然自动改用无限制档。
 *
 * 为什么不是「照用户绑的跑，拒答就拒答」：基础/进阶档挂的都是会拒答的模型，
 * 成人模式下让它们改写只会得到一句「抱歉我无法协助」——那比不给这个功能更糟，
 * 用户会以为站点坏了。这条约束在管理端与用户的技能编辑器上都写明了。
 *
 * 模型不存在或已停用时同样退回 auto：一条技能不该因为运营停用了某个模型就整个失效。
 */
export async function resolveSkillModel(
  modelKey: string,
  opts: { allowSensitive?: boolean }
): Promise<{ model: LlmModelSpec; switched: boolean }> {
  const auto = () => resolveLlmModel(pickTier({ allowSensitive: opts.allowSensitive }));

  const pinned = await getLlmModelByKey(modelKey);
  if (!pinned) return { model: await auto(), switched: false };
  if (opts.allowSensitive && !pinned.uncensored) {
    return { model: await auto(), switched: true };
  }
  return { model: pinned, switched: false };
}
