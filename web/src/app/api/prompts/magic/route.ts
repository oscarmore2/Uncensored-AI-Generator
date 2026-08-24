import { NextResponse } from "next/server";
import { z } from "zod";
import { GENERATION_MODES, GENERATION_TIERS } from "@/lib/generation-modes";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { enhancePrompt } from "@/lib/magic-prompt";
import { getAiCreditsPer1kTokens } from "@/lib/ai-token-billing";
import { creditsForTokens, estimateTokens } from "@/lib/ai-token-cost";
import { db } from "@/lib/db";
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
});

/** 魔法指令：按当前模式的写作规则优化 prompt（不涉及任何上游模型信息） */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!rateLimit(`magic-prompt:${user.id}`, 20, 60_000)) {
    return NextResponse.json({ error: "请求过于频繁，请稍后再试" }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, { status: 400 });
  }

  try {
    if (parsed.data.mode === "undress") {
      return NextResponse.json(
        { error: "脱衣模式不支持魔法指令", code: "MODE_UNSUPPORTED" },
        { status: 400 }
      );
    }

    const adultAccess = hasAdultAccess(user);

    // 入口审查：成人模式只拦绝对红线，非成人模式按分级拦露骨
    const inputSafety = await reviewPrompt({
      mode: parsed.data.mode,
      prompt: parsed.data.prompt,
    });
    if (isBlocked(inputSafety, adultAccess)) {
      return NextResponse.json(
        {
          error: `内容审查未通过：${inputSafety.reason}`,
          code: "CONTENT_POLICY_REJECTED",
          level: inputSafety.level,
        },
        { status: 422 }
      );
    }

    const result = await enhancePrompt({ ...parsed.data, allow_sensitive: adultAccess });

    // 出口复查：扩写后的文本同样要过闸，防止 LLM 越界
    const outputSafety = await reviewPrompt({
      mode: parsed.data.mode,
      prompt: result.prompt,
    });
    if (isBlocked(outputSafety, adultAccess)) {
      return NextResponse.json(
        {
          error: `内容审查未通过：${outputSafety.reason}`,
          code: "CONTENT_POLICY_REJECTED",
          level: outputSafety.level,
        },
        { status: 422 }
      );
    }
    /*
     * 按 token 扣点。
     *
     * 只对真正调用了大模型的那条路收费：source === "local" 是本地规则兜底，
     * 一个 token 都没烧，收钱说不过去。
     *
     * 扣费放在**出口审查通过之后**：审查被拦下来的请求用户什么都没拿到，
     * 不该付钱。代价是那部分上游成本我们自己吃——但反过来（先扣后审）
     * 等于让用户为一个被我们拒绝的结果买单，那更说不过去。
     */
    let charged = 0;
    if (result.source === "dolphin") {
      const per1k = await getAiCreditsPer1kTokens();
      // 拿不到真实用量才估算，且估算只会偏高
      const tokens = result.tokens ?? estimateTokens(parsed.data.prompt + result.prompt);
      charged = creditsForTokens(tokens, per1k);
      if (charged > 0) {
        const ok = await db.user.updateMany({
          where: { id: user.id, balance: { gte: charged } },
          data: { balance: { decrement: charged } },
        });
        if (ok.count === 0) {
          return NextResponse.json(
            { error: "点数不足，请先充值", code: "INSUFFICIENT_CREDITS" },
            { status: 400 }
          );
        }
      }
    }

    return NextResponse.json({
      ok: true,
      charged,
      prompt: result.prompt,
      negative_prompt: result.negative_prompt ?? null,
      source: result.source,
      target: result.target ?? null,
      /* 模型弄丢的素材引用。不猜着补回原文，交给界面提醒用户自己放回去 */
      dropped_refs: result.dropped_refs ?? [],
    });
  } catch (err) {
    console.error("[magic-prompt]", err);
    return NextResponse.json({ error: "魔法指令失败，请稍后重试" }, { status: 400 });
  }
}
