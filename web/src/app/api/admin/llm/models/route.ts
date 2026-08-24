import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { LLM_MODELS, LLM_TIERS } from "@/lib/llm/models";
import { ensureLlmModelsSeeded } from "@/lib/llm/model-store";
import { USD_PER_CREDIT } from "@/lib/llm/billing";
import { chargedMicroFor, formatMicroCredits, MIN_CHARGE_MICRO } from "@/lib/llm/pricing";

/** 一次典型润色：输入 800 token（选区 + 前后文 + system + 模式规则），输出 300 */
const SAMPLE_PROMPT_TOKENS = 800;
const SAMPLE_COMPLETION_TOKENS = 300;

export async function GET() {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await ensureLlmModelsSeeded();
  const models = await db.llmModel.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });

  return NextResponse.json({
    models: models.map((m) => {
      /*
       * 把单价换算成「一次改写扣几点」再显示。
       * 光看 $/Mtok 没有人能立刻判断定价是否合理——它和站内点数之间隔着
       * 单点美元价和加价倍率两层换算，心算必然算错。
       */
      const costUsd =
        (SAMPLE_PROMPT_TOKENS * m.inputUsdPerMTok +
          SAMPLE_COMPLETION_TOKENS * m.outputUsdPerMTok) /
        1_000_000;
      const micro = chargedMicroFor({
        costUsd,
        usdPerCredit: USD_PER_CREDIT,
        multiplierBps: m.priceMultiplierBps,
      });
      return {
        id: m.id,
        key: m.key,
        label: m.label,
        provider: m.provider,
        provider_model_id: m.providerModelId,
        tier_code: m.tierCode,
        input_usd_per_mtok: m.inputUsdPerMTok,
        output_usd_per_mtok: m.outputUsdPerMTok,
        price_multiplier_bps: m.priceMultiplierBps,
        context_tokens: m.contextTokens,
        supports_streaming: m.supportsStreaming,
        uncensored: m.uncensored,
        requires_vip_rank: m.requiresVipRank,
        requires_adult: m.requiresAdult,
        is_active: m.isActive,
        sort_order: m.sortOrder,
        price_synced_at: m.priceSyncedAt,
        sample: {
          cost_usd: Number(costUsd.toFixed(6)),
          charged_credits: formatMicroCredits(micro),
          /** 攒够 1 点要点多少次 */
          calls_per_credit: micro > 0 ? Math.ceil(1000 / micro) : null,
        },
      };
    }),
    tiers: LLM_TIERS,
    defaults: Object.fromEntries(
      LLM_TIERS.map((t) => [
        t,
        {
          key: LLM_MODELS[t].key,
          provider_model_id: LLM_MODELS[t].openRouterModelId,
          input_usd_per_mtok: LLM_MODELS[t].inputUsdPerMTok,
          output_usd_per_mtok: LLM_MODELS[t].outputUsdPerMTok,
        },
      ])
    ),
    pricing: {
      usd_per_credit: Number(USD_PER_CREDIT.toFixed(6)),
      min_charge_micro: MIN_CHARGE_MICRO,
      sample_prompt_tokens: SAMPLE_PROMPT_TOKENS,
      sample_completion_tokens: SAMPLE_COMPLETION_TOKENS,
    },
  });
}
