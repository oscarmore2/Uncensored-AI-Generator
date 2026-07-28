import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { hasPlaythingAccess } from "@/lib/plaything-access";
import { rateLimit } from "@/lib/rate-limit";
import { optimizePrompt, promptOptimizerConfigured } from "@/lib/prompt-optimizer";

/**
 * 玩物专区专属的提示词优化（WaveSpeed prompt-optimizer）。
 * 只做文本改写，不直接触发生成；改写结果回填到输入框后，
 * 实际提交生成时仍会走 /api/plaything/generations 的完整内容审查。
 */

const bodySchema = z.object({
  text: z.string().min(1).max(4000),
  image_url: z.string().url().max(2000).optional(),
  mode: z.enum(["image", "video"]),
  style: z
    .enum(["default", "artistic", "photographic", "technical", "anime", "realistic"])
    .optional(),
});

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPlaythingAccess(user)) {
    return NextResponse.json({ error: "无玩物专区访问权限" }, { status: 403 });
  }

  if (!rateLimit(`plaything-prompt-optimize:${user.id}`, 20, 60_000)) {
    return NextResponse.json({ error: "请求过于频繁，请稍后再试" }, { status: 429 });
  }

  if (!(await promptOptimizerConfigured())) {
    return NextResponse.json({ error: "提示词优化未配置" }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, { status: 400 });
  }
  const d = parsed.data;

  try {
    const prompt = await optimizePrompt({
      text: d.text,
      imageUrl: d.image_url,
      mode: d.mode,
      style: d.style,
    });
    return NextResponse.json({ ok: true, prompt });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "提示词优化失败" },
      { status: 502 }
    );
  }
}
