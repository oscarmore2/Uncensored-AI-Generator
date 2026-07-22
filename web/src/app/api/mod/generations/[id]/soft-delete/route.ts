import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const mod = await requireRole("moderator", "admin");
  if (!mod) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const genId = Number(id);
  if (!Number.isInteger(genId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const result = await db.generation.updateMany({
    where: { id: genId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "作品不存在或已删除" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
