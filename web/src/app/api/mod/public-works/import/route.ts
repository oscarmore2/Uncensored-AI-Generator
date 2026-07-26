import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { publicWorkModOut } from "@/lib/serialize";
import { publicWorkImportSchema } from "@/lib/validators";
import { mirrorRemoteUrls } from "@/lib/oss";

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

  const [mirrored] = await mirrorRemoteUrls([mediaUrl], `public/import-${Date.now()}`);
  const storedUrl = mirrored ?? mediaUrl;

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
