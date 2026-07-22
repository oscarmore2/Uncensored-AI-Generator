import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";

function parseDateParam(s: string | null, endOfDay = false): Date | null {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  if (endOfDay) d.setHours(23, 59, 59, 999);
  else d.setHours(0, 0, 0, 0);
  return d;
}

function buildWhere(url: URL) {
  const type = url.searchParams.get("type");
  const method = url.searchParams.get("method");
  const userId = Number(url.searchParams.get("user_id")) || null;
  const from = parseDateParam(url.searchParams.get("from"));
  const to = parseDateParam(url.searchParams.get("to"), true);

  return {
    ...(type ? { type } : {}),
    ...(method ? { method } : {}),
    ...(userId ? { userId } : {}),
    ...(from || to
      ? {
          createdAt: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        }
      : {}),
  };
}

/** 交易流水：分页，按 type/method/用户/日期筛选 */
export async function GET(req: Request) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 30));
  const where = buildWhere(url);

  const [total, txs] = await Promise.all([
    db.transaction.count({ where }),
    db.transaction.findMany({
      where,
      include: { user: { select: { username: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return NextResponse.json({
    total,
    page,
    limit,
    transactions: txs.map((t) => ({
      id: t.id,
      user_id: t.userId,
      username: t.user.username,
      type: t.type,
      amount: t.amount,
      price_cents: t.priceCents,
      method: t.method,
      stripe_payment_id: t.stripePaymentId,
      created_at: t.createdAt,
    })),
  });
}
