import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { publicWorkModOut } from "@/lib/serialize";
import { mirrorForPermanentUse } from "@/lib/oss";
import { splitModelResult } from "@/lib/plaything-categories";

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

  /*
   * 曝光必须先把媒体拿到自己手里。以前这里用 mirrorRemoteUrls，失败会静默
   * 回落到上游直链——Atlas 的产出因为主机不在白名单里，一次都没镜像成功过，
   * 上游清理后探索页整片裂图。现在镜像不成就不让曝光，把问题挡在写库之前。
   */
  const { urls: stored, unmirrored } = await mirrorForPermanentUse(urls, `public/gen-${genId}`);
  if (unmirrored.length) {
    return NextResponse.json(
      {
        error: `媒体未能镜像到对象存储（${unmirrored.length}/${urls.length} 失败），已取消曝光。请检查 OSS 配置与来源主机白名单后重试。`,
        unmirrored,
      },
      { status: 502 }
    );
  }
  /*
   * 3D 的结果是「模型 + 预览图」两条，原先主体和封面都取第一条，
   * 于是公共库里模型当了封面——探索页只能显示一个立方体占位，
   * 而那张预览图已经上传到 OSS 却再没人引用，等于留了个孤儿文件。
   */
  const { model, poster } = splitModelResult(stored);
  const storedUrl = model ?? stored[0];
  const thumbStored = poster ?? storedUrl;

  const [work] = await db.$transaction([
    db.publicWork.create({
      data: {
        mode: gen.mode,
        prompt: gen.prompt,
        negativePrompt: gen.negativePrompt,
        params: gen.params,
        mediaUrl: storedUrl,
        thumbUrl: thumbStored,
        source: "user_feature",
        sourceGenerationId: gen.id,
        sourceJobId: gen.providerJobId,
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
