import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { publicWorkModOut } from "@/lib/serialize";
import { publicWorkImportSchema } from "@/lib/validators";
import { fetchZenResultUrl } from "@/lib/zen";
import { mirrorRemoteUrls } from "@/lib/oss";

/**
 * 采集导入公共库（Zen 无公开浏览 API，走审核员表单）。
 * 若填了 source_zen_job_id 且配置了 ZEN_API_KEY，尝试自动拉取结果 URL；
 * 拉取失败则要求表单提供 media_url。
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

  let mediaUrl = data.media_url ?? null;
  if (!mediaUrl && data.source_zen_job_id) {
    mediaUrl = await fetchZenResultUrl(data.source_zen_job_id);
  }
  if (!mediaUrl) {
    return NextResponse.json(
      { error: "请提供 media_url，或提供可拉取结果的 source_zen_job_id" },
      { status: 400 }
    );
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
      source: "zen_import",
      sourceZenJobId: data.source_zen_job_id ?? null,
      featuredById: mod.id,
    },
  });

  return NextResponse.json({ ok: true, work: publicWorkModOut(work) }, { status: 201 });
}
