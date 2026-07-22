import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";

/** 用户管理列表：分页/搜索，含封禁状态与累计充值 */
export async function GET(req: Request) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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
        disabledAt: true,
        createdAt: true,
        _count: { select: { generations: true } },
        transactions: {
          where: { type: "recharge" },
          select: { priceCents: true },
        },
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
      disabled_at: u.disabledAt,
      created_at: u.createdAt,
      generation_count: u._count.generations,
      total_recharge_cents: u.transactions.reduce((s, t) => s + (t.priceCents ?? 0), 0),
    })),
  });
}
