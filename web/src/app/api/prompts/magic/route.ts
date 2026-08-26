import { NextResponse } from "next/server";
import { z } from "zod";
import { GENERATION_MODES, GENERATION_TIERS } from "@/lib/generation-modes";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { acquireUserLock } from "@/lib/user-lock";
import { enhancePrompt } from "@/lib/magic-prompt";
import { getSkillForRun } from "@/lib/skills/store";
import { LLM_TIMEOUT_MS } from "@/lib/llm/chat";
import { estimateCostUsd } from "@/lib/llm/models";
import { chargeFieldsOf, recordLlmUsage, vipDiscountBpsOf } from "@/lib/llm/billing";
import { estimateTokens } from "@/lib/ai-token-cost";
import { isBlocked, reviewPrompt } from "@/lib/content-safety";
import { hasAdultAccess } from "@/lib/adult-access";

const bodySchema = z.object({
  prompt: z.string().min(1).max(2000),
  mode: z.enum(GENERATION_MODES).optional(),
  tier: z.enum(GENERATION_TIERS).optional(),
  spicy: z.boolean().optional(),
  style: z.string().max(40).optional(),
  ratio: z.string().max(20).optional(),
  negative_prompt: z.string().max(1000).optional(),
  /** 要跑哪个 manual 技能。不传就是那个官方的「魔法指令」 */
  skill: z.string().min(1).max(64).optional(),
  /**
   * 提示词里 @ 引用的素材：token → URL。
   *
   * URL 服务端会复核只放行自家对象存储上的，见 skills/vision.ts——
   * 前端传什么就发什么，等于开了个「让我们的 LLM 账户去取任意 URL」的口子。
   */
  refs: z
    .array(z.object({ token: z.string().min(1).max(32), url: z.string().url().max(2000) }))
    .max(20)
    .optional(),

});

const LOCK_TTL_MS = LLM_TIMEOUT_MS + 10_000;
const DEFAULT_MANUAL_SKILL = "magic-prompt";

/**
 * 整段级技能（`manual` 时机）。魔法指令就是这里的第一个官方技能。
 *
 * 与选区级的差别只有两点：改的是整段而不是一段选区；支持反向提示词的档位
 * 会额外回一个 negative_prompt。其余——上游、档位选择、按 token 的微点计费、
 * 用量台账、并发锁——都是同一套。
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!rateLimit(`magic-prompt:${user.id}`, 20, 60_000)) {
    return NextResponse.json({ error: "请求过于频繁，请稍后再试" }, { status: 429 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, { status: 400 });
  }
  const input = parsed.data;

  if (input.mode === "undress") {
    return NextResponse.json(
      { error: "脱衣模式不支持魔法指令", code: "MODE_UNSUPPORTED" },
      { status: 400 }
    );
  }

  const skill = await getSkillForRun(input.skill ?? DEFAULT_MANUAL_SKILL, user.id);
  if (!skill || !skill.isActive || !skill.triggers.includes("manual")) {
    return NextResponse.json({ error: "该技能不可用", code: "SKILL_UNAVAILABLE" }, { status: 400 });
  }

  /* 发起新调用要求余额 > 0（规划 6.2b）。跑起来之后一律结算到底 */
  if (user.balance <= 0) {
    return NextResponse.json(
      { error: "点数不足，请先充值", code: "INSUFFICIENT_CREDITS" },
      { status: 400 }
    );
  }

  /*
   * 与选区级 AI **共用同一把锁**。「同一时刻只允许一个 AI 动作」是针对
   * 用户的，不是针对某个功能的——魔法指令正在重写整段的时候，
   * 选区级动作改的是一份马上就要被覆盖掉的文本。
   */
  const release = acquireUserLock(`ai:${user.id}`, LOCK_TTL_MS);
  if (!release) {
    return NextResponse.json(
      { error: "上一个 AI 动作还在跑，请等它结束", code: "AI_BUSY" },
      { status: 429 }
    );
  }

  try {
    const adultAccess = hasAdultAccess(user);

    // 入口审查：成人模式只拦绝对红线，非成人模式按分级拦露骨
    const inputSafety = await reviewPrompt({ mode: input.mode, prompt: input.prompt });
    if (isBlocked(inputSafety, adultAccess)) {
      // 上游一次都没调，不收钱
      return NextResponse.json(
        {
          error: `内容审查未通过：${inputSafety.reason}`,
          code: "CONTENT_POLICY_REJECTED",
          level: inputSafety.level,
        },
        { status: 422 }
      );
    }

    const result = await enhancePrompt({ ...input, allow_sensitive: adultAccess }, skill);

    // 出口复查：扩写后的文本同样要过闸，防止 LLM 越界
    const outputSafety = await reviewPrompt({ mode: input.mode, prompt: result.prompt });
    const blocked = isBlocked(outputSafety, adultAccess);

    /*
     * 扣费。判据与选区级一致：**上游跑了没有**。
     * source === "local" 是本地规则兜底，一个 token 都没烧，收钱说不过去；
     * 跑过了就收，哪怕结果被出口审查拦下来——那笔钱已经花出去了。
     */
    const ranUpstream = result.source === "llm" && Boolean(result.model);
    const settled = ranUpstream
      ? await recordLlmUsage({
          userId: user.id,
          skillKey: skill.key,
          modelKey: result.model!.key,
          trigger: "manual",
          multiplierBps: result.model!.priceMultiplierBps,
          vipDiscountBps: vipDiscountBpsOf(user),
          status: blocked ? "blocked" : "ok",
          charge: true,
          ...measure(result.usage, result.model!, input.prompt, result.prompt),
        })
      : null;

    if (blocked) {
      return NextResponse.json(
        {
          error: `内容审查未通过：${outputSafety.reason}`,
          code: "CONTENT_POLICY_REJECTED",
          level: outputSafety.level,
          ...(settled ? chargeFieldsOf(settled) : {}),
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      ok: true,
      prompt: result.prompt,
      negative_prompt: result.negative_prompt ?? null,
      source: result.source,
      target: result.target ?? null,
      images: result.images ?? 0,
      /* 模型弄丢的素材引用。不猜着补回原文，交给界面提醒用户自己放回去 */
      dropped_refs: result.dropped_refs ?? [],
      ...(settled ? chargeFieldsOf(settled) : {}),
    });
  } catch (err) {
    console.error("[magic-prompt]", err);
    return NextResponse.json({ error: "魔法指令失败，请稍后重试" }, { status: 400 });
  } finally {
    release();
  }
}

/**
 * 拿上游的真账，拿不到就按本地单价估。
 * **查不到成本绝不能变成「这次不扣费」**——上游的钱已经花了。
 */
function measure(
  usage: { promptTokens?: number; completionTokens?: number; costUsd?: number; costEstimated?: boolean } | undefined,
  model: { inputUsdPerMTok: number; outputUsdPerMTok: number },
  promptText: string,
  outputText: string
) {
  const promptTokens = usage?.promptTokens ?? estimateTokens(promptText);
  const completionTokens = usage?.completionTokens ?? estimateTokens(outputText);
  if (usage?.costUsd != null) {
    return {
      promptTokens,
      completionTokens,
      costUsd: usage.costUsd,
      costEstimated: usage.costEstimated ?? false,
    };
  }
  return {
    promptTokens,
    completionTokens,
    costUsd: estimateCostUsd(model as Parameters<typeof estimateCostUsd>[0], promptTokens, completionTokens),
    costEstimated: true,
  };
}
