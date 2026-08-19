import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";

const patchSchema = z.object({
  label: z.string().trim().min(1).max(60).optional(),
  match_model_id: z.string().trim().max(200).optional(),
  provider: z.string().trim().max(40).nullable().optional(),
  image_format: z.string().max(60).optional(),
  video_format: z.string().max(60).optional(),
  audio_format: z.string().max(60).optional(),
  enabled: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(9999).optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await requireRole("admin"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "参数无效" }, { status: 400 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const d = parsed.data;
  await db.modelRefSyntax.update({
    where: { id },
    data: {
      ...(d.label !== undefined ? { label: d.label } : {}),
      ...(d.match_model_id !== undefined ? { matchModelId: d.match_model_id } : {}),
      ...(d.provider !== undefined ? { provider: d.provider || null } : {}),
      ...(d.image_format !== undefined ? { imageFormat: d.image_format } : {}),
      ...(d.video_format !== undefined ? { videoFormat: d.video_format } : {}),
      ...(d.audio_format !== undefined ? { audioFormat: d.audio_format } : {}),
      ...(d.enabled !== undefined ? { enabled: d.enabled } : {}),
      ...(d.sort_order !== undefined ? { sortOrder: d.sort_order } : {}),
    },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await requireRole("admin"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "参数无效" }, { status: 400 });
  await db.modelRefSyntax.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
