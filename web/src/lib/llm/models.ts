/**
 * 文本 LLM 的档位、模型与单价。**S0 阶段全部写死在代码里**，不进 DB。
 *
 * 分期规划（AI_SKILL_SYSTEM_PLAN 第九节）把 `LlmModel` 表留给 S1。这里先当常量，
 * 是为了让 S0 只解决管线本身的问题——流式、锚点、审查、并发、计费精度，
 * 每一条都会单独出错。跟「配置从哪来」混在一期，出问题时分不清是哪边坏的。
 *
 * ⚠️ 边界（规划 7.2）：**`label` 与 `openRouterModelId` 允许下发到前端**，
 * 因为技能系统里「用哪个模型」本来就是用户在选，公开它不损失任何东西。
 * 这与 `GenerationProduct.label` / `providerModelId` 是**两回事**——
 * 生成端要藏的是「哪个模型撑起哪个档位」，整套档位定价建立在这上面。
 * 日后别看着不一致就顺手把两边改成一样。
 *
 * 这一层不带 server-only：前端要显示档位名与预估价。密钥与调用在 chat.ts。
 */

export const LLM_TIERS = ["basic", "advanced", "unrestricted"] as const;
export type LlmTier = (typeof LLM_TIERS)[number];

export type LlmModelSpec = {
  /** 稳定标识。S1 建表时它就是 `LlmModel.key` */
  key: string;
  /** 面向用户，可含模型名 */
  label: string;
  tierCode: LlmTier;
  /** OpenRouter 上的模型 id。走 HF 兜底时不用它，见 chat.ts */
  openRouterModelId: string;
  /** 上游单价，美元 / 百万 token。只用于预估与成本可见性，真账以上游返回为准 */
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  /** 加价倍率，与生成端同口径：普通 130%、无限制档 150% */
  priceMultiplierBps: number;
  contextTokens: number;
  supportsStreaming: boolean;
  /** true 时必须 requiresAdult 也为 true（规划 7.3） */
  uncensored: boolean;
  requiresVipRank: number;
  requiresAdult: boolean;
};

/**
 * 三档对齐生成端已有的 low / mid / high 心智。
 *
 * 单价取自 OpenRouter 公开模型列表（2026-08 实测），与规划 6.4 的参考价一致。
 */
export const LLM_MODELS: Record<LlmTier, LlmModelSpec> = {
  basic: {
    key: "basic-4o-mini",
    label: "基础 · GPT-4o mini",
    tierCode: "basic",
    openRouterModelId: "openai/gpt-4o-mini",
    inputUsdPerMTok: 0.15,
    outputUsdPerMTok: 0.6,
    priceMultiplierBps: 13000,
    contextTokens: 128000,
    supportsStreaming: true,
    uncensored: false,
    requiresVipRank: 0,
    requiresAdult: false,
  },
  advanced: {
    key: "advanced-4o",
    label: "进阶 · GPT-4o",
    tierCode: "advanced",
    openRouterModelId: "openai/gpt-4o",
    inputUsdPerMTok: 2.5,
    outputUsdPerMTok: 10,
    priceMultiplierBps: 13000,
    contextTokens: 128000,
    supportsStreaming: true,
    uncensored: false,
    requiresVipRank: 1,
    requiresAdult: false,
  },
  /*
   * 就是站内现在这个 Dolphin-Mistral-24B-Venice——`magic-prompt` 的 source
   * 之所以叫 "dolphin" 就是它。换到 OpenRouter 之后模型没变，只是换了条路进去，
   * 所以成人模式下的改写行为与现在一致，不需要重新调提示词。
   */
  unrestricted: {
    key: "unrestricted-dolphin-venice",
    label: "无限制 · Dolphin Mistral 24B (Venice)",
    tierCode: "unrestricted",
    openRouterModelId: "cognitivecomputations/dolphin-mistral-24b-venice-edition",
    inputUsdPerMTok: 0.2,
    outputUsdPerMTok: 0.9,
    priceMultiplierBps: 15000,
    contextTokens: 128000,
    supportsStreaming: true,
    uncensored: true,
    requiresVipRank: 0,
    requiresAdult: true,
  },
};

/**
 * S0 没有模型选择界面，档位是**自动**定的：成人模式用无限制档，其余用基础档。
 *
 * 这不是图省事。基础档挂的是会拒答的模型，成人模式下让它改写只会得到一句
 * 「抱歉我无法协助」——那比不给这个功能更糟，用户会以为是站点坏了。
 * 反过来非成人内容没有理由去用贵 33% 的无限制档。
 *
 * 进阶档在 S0 里够不着：它要 VIP 判定与用户可见的模型选择，属于 S1/S2。
 */
export function pickTier(opts: { allowSensitive?: boolean }): LlmTier {
  return opts.allowSensitive ? "unrestricted" : "basic";
}

/** 按本地单价估成本。上游给了真账就别用它——估算值与真实值混在一起对不了账 */
export function estimateCostUsd(
  spec: LlmModelSpec,
  promptTokens: number,
  completionTokens: number
): number {
  return (
    (promptTokens * spec.inputUsdPerMTok + completionTokens * spec.outputUsdPerMTok) / 1_000_000
  );
}
