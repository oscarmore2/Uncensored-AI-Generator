import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { publicWorkModOut } from "@/lib/serialize";
import { mirrorRemoteUrls } from "@/lib/oss";

/** 曝光：把用户作品复制为 PublicWork 独立副本，并标记原作品 visibility=featured */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const mod = await requireRole("moderator", "admin");
  if (!mod) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const genId = Number(id);
  if (!Number.isInteger(genId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const gen = await db.generation.findUnique({ where: { id: genId } });
  if (!gen) return NextResponse.json({ error: "作品不存在" }, { status: 404 });
  if (gen.status !== "succeeded" || !gen.resultUrls) {
    return NextResponse.json({ error: "只能曝光生成成功的作品" }, { status: 400 });
  }
  const selectionDeadline = new Date(gen.createdAt.getTime() + 7 * 24 * 60 * 60 * 1000);
  if (Date.now() >= selectionDeadline.getTime()) {
    return NextResponse.json(
      { error: "作品生成已超过 7 天，无法再设为精选" },
      { status: 410 }
    );
  }

  const existing = await db.publicWork.findFirst({ where: { sourceGenerationId: genId } });
  if (existing) {
    return NextResponse.json({ error: "该作品已曝光到公共库", work: publicWorkModOut(existing) }, { status: 409 });
  }

  const urls = JSON.parse(gen.resultUrls) as string[];
  if (!urls.length) return NextResponse.json({ error: "作品没有可用的结果 URL" }, { status: 400 });

  const [mediaUrl] = await mirrorRemoteUrls(urls, `public/gen-${genId}`);
  const storedUrl = mediaUrl ?? urls[0];

  const [work] = await db.$transaction([
    db.publicWork.create({
      data: {
        mode: gen.mode,
        prompt: gen.prompt,
        negativePrompt: gen.negativePrompt,
        params: gen.params,
        mediaUrl: storedUrl,
        thumbUrl: storedUrl,
        source: "user_feature",
        sourceGenerationId: gen.id,
        sourceZenJobId: gen.zenJobId,
        isAdult: gen.isAdult,
        featuredById: mod.id,
      },
    }),
    db.generation.update({
      where: { id: genId },
      data: { visibility: "featured", mediaExpiresAt: null },
    }),
  ]);

  return NextResponse.json({ ok: true, work: publicWorkModOut(work) }, { status: 201 });
}
