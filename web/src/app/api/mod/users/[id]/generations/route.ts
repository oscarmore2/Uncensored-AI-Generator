import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { generationModOut } from "@/lib/serialize";

/** 某用户的全部作品（含已软删），审核端管理用 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const mod = await requireRole("moderator", "admin");
  if (!mod) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const userId = Number(id);
  if (!Number.isInteger(userId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, balance: true, role: true },
  });
  if (!user) return NextResponse.json({ error: "用户不存在" }, { status: 404 });

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 30));

  const [total, gens] = await Promise.all([
    db.generation.count({ where: { userId } }),
    db.generation.findMany({
      where: { userId },
      include: { user: { select: { username: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return NextResponse.json({
    user,
    total,
    page,
    limit,
    generations: gens.map(generationModOut),
  });
}
