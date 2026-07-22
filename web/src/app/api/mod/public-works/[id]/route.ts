import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { publicWorkModOut } from "@/lib/serialize";
import { publicWorkPatchSchema } from "@/lib/validators";

/** 公共库单条：上下架 / 排序 / 改标题 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const mod = await requireRole("moderator", "admin");
  if (!mod) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const workId = Number(id);
  if (!Number.isInteger(workId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = publicWorkPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, { status: 400 });
  }

  const existing = await db.publicWork.findUnique({ where: { id: workId } });
  if (!existing) return NextResponse.json({ error: "作品不存在" }, { status: 404 });

  const work = await db.publicWork.update({
    where: { id: workId },
    data: {
      ...(parsed.data.is_published !== undefined ? { isPublished: parsed.data.is_published } : {}),
      ...(parsed.data.sort_order !== undefined ? { sortOrder: parsed.data.sort_order } : {}),
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
    },
  });

  return NextResponse.json({ ok: true, work: publicWorkModOut(work) });
}

/** 从公共库彻底删除（不影响原用户作品） */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const mod = await requireRole("moderator", "admin");
  if (!mod) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const workId = Number(id);
  if (!Number.isInteger(workId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const work = await db.publicWork.findUnique({ where: { id: workId } });
  if (!work) return NextResponse.json({ error: "作品不存在" }, { status: 404 });

  await db.$transaction([
    db.publicWork.delete({ where: { id: workId } }),
    // 原作品回归 private，允许日后重新曝光
    ...(work.sourceGenerationId
      ? [
          db.generation.updateMany({
            where: { id: work.sourceGenerationId, visibility: "featured" },
            data: { visibility: "private" },
          }),
        ]
      : []),
  ]);

  return NextResponse.json({ ok: true });
}
