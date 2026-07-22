import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { bulkIdsSchema } from "@/lib/validators";

export async function POST(req: Request) {
  const mod = await requireRole("moderator", "admin");
  if (!mod) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = bulkIdsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "无效的 ID 列表" }, { status: 400 });
  }

  const result = await db.generation.updateMany({
    where: { id: { in: parsed.data.ids }, deletedAt: null },
    data: { deletedAt: new Date() },
  });

  return NextResponse.json({ ok: true, deleted: result.count });
}
