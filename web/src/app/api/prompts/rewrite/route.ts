import { NextResponse } from "next/server";
import { z } from "zod";
import { GENERATION_MODES, GENERATION_TIERS } from "@/lib/generation-modes";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { CONTEXT_CHARS, rewriteSelection } from "@/lib/prompt-rewrite";
import { getAiCreditsPer1kTokens } from "@/lib/ai-token-billing";
import { creditsForTokens, estimateTokens } from "@/lib/ai-token-cost";
import { db } from "@/lib/db";
import { isBlocked, reviewPrompt } from "@/lib/content-safety";
import { hasAdultAccess } from "@/lib/adult-access";

const bodySchema = z.object({
  action: z.enum(["polish", "localize", "expand", "shorten", "emphasize"]),
  selection: z.string().min(1).max(2000),
  context_before: z.string().max(CONTEXT_CHARS).default(""),
  context_after: z.string().max(CONTEXT_CHARS).default(""),
  mode: z.enum(GENERATION_MODES).optional(),
  tier: z.enum(GENERATION_TIERS).optional(),
  spicy: z.boolean().optional(),
  target_chars: z.number().int().min(10).max(2000).optional(),
});

/**
 * 选区级 AI：只改用户选中的那一段。
 *
 * 与魔法指令的关键差别是**审查对象**：这里审的是「替换之后的全文」，
 * 不是模型回的那个片段。片段脱离上下文两个方向都会误判——
 * 整段里越线的话孤立看无害，孤立看越线的话放回整段可能完全正常。
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  /*
   * 限流比魔法指令宽：选区级动作天然就是高频的，选中一句润色一下就是一次。
   * 真正的成本闸门是按 token 扣点，不是次数——次数限制在这里只用来
   * 挡住脚本化的滥用。
   */
  if (!rateLimit(`prompt-rewrite:${user.id}`, 60, 60_000)) {
    return NextResponse.json({ error: "请求过于频繁，请稍后再试" }, { status: 429 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "参数无效" },
      { status: 400 }
    );
  }
  const input = parsed.data;

  if (input.mode === "undress") {
    return NextResponse.json({ error: "该模式不支持提示词改写" }, { status: 400 });
  }

  const adultAccess = hasAdultAccess(user);
  /** 把片段放回原位，得到「用户实际会看到的整段文本」 */
  const assemble = (fragment: string) =>
    `${input.context_before}${fragment}${input.context_after}`;

  try {
    // 入口审查同样按整段判，理由与出口一致
    const inputSafety = await reviewPrompt({
      mode: input.mode ?? "txt2img",
      prompt: assemble(input.selection),
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

    const result = await rewriteSelection({
      action: input.action,
      selection: input.selection,
      contextBefore: input.context_before,
      contextAfter: input.context_after,
      mode: input.mode ?? "txt2img",
      tier: input.tier,
      spicy: input.spicy,
      allowSensitive: adultAccess,
      targetChars: input.target_chars,
    });

    if (!result) {
      return NextResponse.json(
        { error: "改写未启用或上游无响应，请稍后重试", code: "REWRITE_UNAVAILABLE" },
        { status: 503 }
      );
    }

    const outputSafety = await reviewPrompt({
      mode: input.mode ?? "txt2img",
      prompt: assemble(result.text),
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
     * 扣点。与魔法指令同一套规则：审查通过之后才收钱——
     * 被我们拒绝的结果不该让用户买单。
     */
    const per1k = await getAiCreditsPer1kTokens();
    const tokens = result.tokens ?? estimateTokens(input.selection + result.text);
    const charged = creditsForTokens(tokens, per1k);
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

    return NextResponse.json({
      ok: true,
      /** 只回改写后的片段，替换由前端在原选区上做 */
      text: result.text,
      charged,
      dropped_refs: result.droppedRefs,
    });
  } catch (err) {
    console.error("[prompt-rewrite]", err);
    return NextResponse.json({ error: "改写失败，请稍后重试" }, { status: 400 });
  }
}
