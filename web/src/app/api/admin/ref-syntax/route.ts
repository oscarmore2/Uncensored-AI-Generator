import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";

/** 各家模型的媒体引用语法。匹配不到任何一行时原样透传（见 lib/model-ref-syntax）。 */

const ruleSchema = z.object({
  label: z.string().trim().min(1, "请填写名称").max(60),
  match_model_id: z.string().trim().max(200).default(""),
  provider: z.string().trim().max(40).nullable().optional(),
  image_format: z.string().max(60).default("@image{n}"),
  video_format: z.string().max(60).default("@video{n}"),
  audio_format: z.string().max(60).default("@audio{n}"),
  enabled: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(9999).optional(),
});

function out(r: {
  id: number;
  label: string;
  matchModelId: string;
  provider: string | null;
  imageFormat: string;
  videoFormat: string;
  audioFormat: string;
  enabled: boolean;
  sortOrder: number;
}) {
  return {
    id: r.id,
    label: r.label,
    match_model_id: r.matchModelId,
    provider: r.provider,
    image_format: r.imageFormat,
    video_format: r.videoFormat,
    audio_format: r.audioFormat,
    enabled: r.enabled,
    sort_order: r.sortOrder,
  };
}

export async function GET() {
  if (!(await requireRole("admin"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const rows = await db.modelRefSyntax.findMany({
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  return NextResponse.json(rows.map(out));
}

export async function POST(req: Request) {
  if (!(await requireRole("admin"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const parsed = ruleSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const d = parsed.data;
  const created = await db.modelRefSyntax.create({
    data: {
      label: d.label,
      matchModelId: d.match_model_id,
      provider: d.provider || null,
      imageFormat: d.image_format,
      videoFormat: d.video_format,
      audioFormat: d.audio_format,
      enabled: d.enabled ?? true,
      sortOrder: d.sort_order ?? 0,
    },
  });
  return NextResponse.json(out(created), { status: 201 });
}
