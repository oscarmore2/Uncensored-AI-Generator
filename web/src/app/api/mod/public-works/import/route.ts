import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { publicWorkModOut } from "@/lib/serialize";
import { publicWorkImportSchema } from "@/lib/validators";
import { mirrorForPermanentUse } from "@/lib/oss";

/**
 * 采集导入公共库：审核员填表提交，媒体统一镜像到对象存储。
 * source_job_id 仅作溯源备注。
 */
export async function POST(req: Request) {
  const mod = await requireRole("moderator", "admin");
  if (!mod) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = publicWorkImportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, { status: 400 });
  }
  const data = parsed.data;

  const mediaUrl = data.media_url ?? null;
  if (!mediaUrl) {
    return NextResponse.json({ error: "请提供 media_url" }, { status: 400 });
  }

  // 同曝光路径：镜像不成就不入库，别把会过期的上游直链挂到公共库上
  const { urls: mirrored, unmirrored } = await mirrorForPermanentUse(
    [mediaUrl],
    `public/import-${Date.now()}`
  );
  if (unmirrored.length) {
    return NextResponse.json(
      { error: "媒体未能镜像到对象存储，已取消导入。请检查 OSS 配置与来源主机白名单后重试。" },
      { status: 502 }
    );
  }
  const storedUrl = mirrored[0] ?? mediaUrl;

  const work = await db.publicWork.create({
    data: {
      title: data.title ?? null,
      mode: data.mode,
      prompt: data.prompt,
      negativePrompt: data.negative_prompt ?? null,
      params: JSON.stringify(data.params ?? {}),
      mediaUrl: storedUrl,
      thumbUrl: storedUrl,
      source: "provider_import",
      sourceJobId: data.source_job_id ?? null,
      isAdult: data.is_adult,
      featuredById: mod.id,
    },
  });

  return NextResponse.json({ ok: true, work: publicWorkModOut(work) }, { status: 201 });
}
