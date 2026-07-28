import { NextResponse } from "next/server";
import { z } from "zod";
import { GENERATION_MODES, GENERATION_TIERS } from "@/lib/generation-modes";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { enhancePrompt } from "@/lib/magic-prompt";
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
    return NextResponse.json({
      ok: true,
      prompt: result.prompt,
      negative_prompt: result.negative_prompt ?? null,
      source: result.source,
      target: result.target ?? null,
    });
  } catch (err) {
    console.error("[magic-prompt]", err);
    return NextResponse.json({ error: "魔法指令失败，请稍后重试" }, { status: 400 });
  }
}
