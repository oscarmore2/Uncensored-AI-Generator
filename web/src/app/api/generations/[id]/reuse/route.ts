import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { extractInputUrls } from "@/lib/generation-media";
import { resolveInputMediaStatus } from "@/lib/reuse-media";
import { modeNeedsImage } from "@/lib/generation-modes";

/**
 * 「套用 / 重新生成」的数据源：把一条历史任务还原成生成页可以直接吃的表单值，
 * 并告知当初的参考图还在不在（不在就让前端弹框说明，只填参数不填图）。
 */

const UI_KEYS_TO_SKIP = new Set([
  "image_base64",
  "image_filename",
  "input_urls",
  "result_thumb_urls",
  "product_id",
  "tier",
  "spicy",
]);

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "参数无效" }, { status: 400 });
  }

  const gen = await db.generation.findFirst({
    where: { id, userId: user.id, deletedAt: null },
  });
  if (!gen) return NextResponse.json({ error: "作品不存在" }, { status: 404 });

  try {
    return NextResponse.json(await buildReusePayload(user.id, gen));
  } catch (err) {
    // 不要吞掉原因：前端只显示「读取失败」时，排查得从服务端日志翻起
    console.error("[reuse] 读取原任务失败：", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "读取原任务参数失败" },
      { status: 500 }
    );
  }
}

async function buildReusePayload(
  userId: number,
  gen: { id: number; mode: string; tier: string; spicy: boolean; prompt: string; negativePrompt: string | null; params: string }
) {

  let params: Record<string, unknown> = {};
  try {
    params = JSON.parse(gen.params) as Record<string, unknown>;
  } catch {
    params = {};
  }

  const media = await resolveInputMediaStatus({
    userId,
    channel: "main",
    sourceId: gen.id,
    paramUrls: extractInputUrls(params),
  });

  // 只回传能还原到表单的标量参数
  const uiParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (UI_KEYS_TO_SKIP.has(key)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      uiParams[key] = String(value);
    }
  }

  const needsImage = modeNeedsImage(gen.mode);

  return {
    id: gen.id,
    mode: gen.mode,
    tier: gen.tier,
    spicy: gen.spicy,
    prompt: gen.prompt,
    negative_prompt: gen.negativePrompt ?? "",
    params: uiParams,
    // 脱衣的性别与高级选项是对象，单独带出来
    gender: typeof params.gender === "string" ? params.gender : null,
    undress_options: params.undress_options ?? null,
    needs_image: needsImage,
    media,
    /**
     * 这条记录压根没留下参考图的线索（改动之前的老任务），
     * 与「传过但被清理了」是两回事，前端提示文案不同。
     */
    input_unrecorded: needsImage && media.items.length === 0,
  };
}
