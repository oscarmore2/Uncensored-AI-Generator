import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";

/** 加密支付订单列表：排查未到账 / wrong_amount 等情况 */
export async function GET(req: Request) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 30));
  const status = url.searchParams.get("status");
  // credited=0 用于快速筛出「未入账」的订单
  const credited = url.searchParams.get("credited");

  const where = {
    ...(status ? { status } : {}),
    ...(credited === "0" ? { credited: false } : credited === "1" ? { credited: true } : {}),
  };

  const [total, payments] = await Promise.all([
    db.cryptoPayment.count({ where }),
    db.cryptoPayment.findMany({
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
    payments: payments.map((p) => ({
      id: p.id,
      order_id: p.orderId,
      user_id: p.userId,
      username: p.user.username,
      credits: p.credits,
      amount_usd_cents: p.amountUsdCents,
      status: p.status,
      credited: p.credited,
      txid: p.txid,
      network: p.network,
      payer_currency: p.payerCurrency,
      created_at: p.createdAt,
      updated_at: p.updatedAt,
    })),
  });
}
