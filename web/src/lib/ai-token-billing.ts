import "server-only";
import { db } from "./db";

export { creditsForTokens, estimateTokens } from "./ai-token-cost";

/**
 * AI 文本动作按 token 计费。
 *
 * 与生成扣点分开定价：改一句提示词和出一段视频的成本差好几个数量级，
 * 套同一张价目表会让文本动作贵得没人敢点、或者视频便宜到亏本。
 *
 * 费率放 AppSetting 而不是写死：真实用量要上线之后才看得出来，
 * 写死意味着每次调价都要发版。
 */

export const AI_CREDITS_PER_1K_TOKENS_KEY = "ai_credits_per_1k_tokens";

/**
 * 默认 1 点 / 1000 token。
 *
 * 一次改写连 system prompt、上下文、输出加起来通常 600~1500 token，
 * 也就是 1~2 点。注册就送 200 点，够用几百次——刻意定得便宜：
 * 这个功能的价值在于让人愿意反复试，卡得太紧就等于没做。
 * 觉得不合适在管理端改，不用发版。
 */
export const DEFAULT_AI_CREDITS_PER_1K_TOKENS = 1;

/** 上限只是防手滑输入，不是业务约束 */
const MAX_RATE = 1000;

export async function getAiCreditsPer1kTokens(): Promise<number> {
  const setting = await db.appSetting.findUnique({
    where: { key: AI_CREDITS_PER_1K_TOKENS_KEY },
    select: { value: true },
  });
  if (!setting) return DEFAULT_AI_CREDITS_PER_1K_TOKENS;
  const value = Number(setting.value);
  return Number.isFinite(value) && value >= 0 && value <= MAX_RATE
    ? value
    : DEFAULT_AI_CREDITS_PER_1K_TOKENS;
}

export async function setAiCreditsPer1kTokens(value: number): Promise<void> {
  await db.appSetting.upsert({
    where: { key: AI_CREDITS_PER_1K_TOKENS_KEY },
    create: { key: AI_CREDITS_PER_1K_TOKENS_KEY, value: String(value) },
    update: { value: String(value) },
  });
}
