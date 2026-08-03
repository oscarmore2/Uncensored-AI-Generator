import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { hasPlaythingAccess } from "@/lib/plaything-access";
import { extractInputUrls } from "@/lib/generation-media";
import { resolveInputMediaStatus } from "@/lib/reuse-media";
import { playthingProductInclude } from "@/lib/plaything-serialize";
import { resolvePlaythingCategory } from "@/lib/plaything-categories";

/** 玩物专区的「套用 / 重新生成」数据源，语义与创作中心那条一致 */

const SKIP = new Set(["image_base64", "input_urls", "result_thumb_urls"]);

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPlaythingAccess(user)) {
    return NextResponse.json({ error: "无玩物专区访问权限" }, { status: 403 });
  }

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "参数无效" }, { status: 400 });
  }

  const gen = await db.waveSpeedGeneration.findFirst({
    where: { id, userId: user.id },
    include: { product: { select: playthingProductInclude } },
  });
  if (!gen) return NextResponse.json({ error: "作品不存在" }, { status: 404 });

  try {
    return NextResponse.json(await build(user.id, gen));
  } catch (err) {
    console.error("[plaything reuse] 读取原任务失败：", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "读取原任务参数失败" },
      { status: 500 }
    );
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function build(userId: number, gen: any) {
  let params: Record<string, unknown> = {};
  try {
    params = JSON.parse(gen.params) as Record<string, unknown>;
  } catch {
    params = {};
  }

  const inputUrls = extractInputUrls(params);
  const media = await resolveInputMediaStatus({
    userId,
    channel: "plaything",
    sourceId: gen.id,
    paramUrls: inputUrls,
  });

  // 媒体字段的值就是 URL，回填时由前端按字段名重新挂；这里只留非媒体的标量
  const inputUrlSet = new Set(inputUrls);
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (SKIP.has(key) || key === "prompt" || key === "negative_prompt") continue;
    if (typeof value === "string" && inputUrlSet.has(value)) continue;
    if (Array.isArray(value)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      fields[key] = String(value);
    }
  }

  // 哪些字段当初挂了媒体，套用时要按字段名还原回去
  const mediaFields: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(params)) {
    const list = Array.isArray(value) ? value : [value];
    const urls = list.filter(
      (v): v is string => typeof v === "string" && inputUrlSet.has(v)
    );
    if (urls.length) mediaFields[key] = urls;
  }

  const { category, media_kind } = resolvePlaythingCategory(
    gen.product?.catalogModel?.type ?? "",
    gen.product?.modelId ?? ""
  );

  return {
    id: gen.id,
    product_id: gen.productId,
    product_label: gen.product?.label ?? null,
    category,
    media_kind,
    prompt: gen.prompt,
    negative_prompt: typeof params.negative_prompt === "string" ? params.negative_prompt : "",
    fields,
    media_fields: mediaFields,
    media,
    input_unrecorded: Object.keys(mediaFields).length === 0 && media.items.length === 0,
  };
}
