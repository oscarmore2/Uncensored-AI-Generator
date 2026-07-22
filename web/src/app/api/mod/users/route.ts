import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";

/** 用户列表（含作品数），支持用户名搜索，分页 */
export async function GET(req: Request) {
  const mod = await requireRole("moderator", "admin");
  if (!mod) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 30));
  const q = url.searchParams.get("q")?.trim();

  const where = q ? { username: { contains: q } } : {};

  const [total, users] = await Promise.all([
    db.user.count({ where }),
    db.user.findMany({
      where,
      select: {
        id: true,
        username: true,
        role: true,
        balance: true,
        isVip: true,
        createdAt: true,
        _count: { select: { generations: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return NextResponse.json({
    total,
    page,
    limit,
    users: users.map((u) => ({
      id: u.id,
      username: u.username,
      role: u.role,
      balance: u.balance,
      is_vip: u.isVip,
      created_at: u.createdAt,
      generation_count: u._count.generations,
    })),
  });
}
