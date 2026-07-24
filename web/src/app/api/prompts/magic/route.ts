import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { enhancePrompt } from "@/lib/magic-prompt";
import { reviewPromptWithHarness } from "@/lib/content-safety";
import { isVipActive } from "@/lib/pricing";

const bodySchema = z.object({
  prompt: z.string().min(1).max(2000),
  mode: z.enum(["txt2img", "txt2vid", "img2img", "img2vid", "undress"]).optional(),
  style: z.string().max(40).optional(),
  ratio: z.string().max(20).optional(),
  quality: z.string().max(40).optional(),
  zen_model: z.string().max(80).optional(),
  undress_variant: z.enum(["female", "male", "couple"]).optional(),
  negative_prompt: z.string().max(1000).optional(),
});

/** 魔法指令：按当前模式对应的 Zen 模型格式优化 prompt */
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
    if (!isVipActive(user)) {
      const inputSafety = await reviewPromptWithHarness({
        mode: parsed.data.mode,
        prompt: parsed.data.prompt,
      });
      if (!inputSafety.allowed) {
        return NextResponse.json(
          { error: `内容审查未通过：${inputSafety.reason}`, code: "CONTENT_POLICY_REJECTED" },
          { status: 422 }
        );
      }
    }
    const result = await enhancePrompt(parsed.data);
    if (!isVipActive(user)) {
      const safety = await reviewPromptWithHarness({
        mode: parsed.data.mode,
        prompt: result.prompt,
      });
      if (!safety.allowed) {
        return NextResponse.json(
          { error: `内容审查未通过：${safety.reason}`, code: "CONTENT_POLICY_REJECTED" },
          { status: 422 }
        );
      }
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
