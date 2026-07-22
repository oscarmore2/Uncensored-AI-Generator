import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

/** 前端轮询自己最近一笔加密支付的状态（Webhook 入账后此处可见 credited=true） */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orderId = new URL(req.url).searchParams.get("order_id");
  if (!orderId) return NextResponse.json({ error: "Missing order_id" }, { status: 400 });

  const payment = await db.cryptoPayment.findFirst({
    where: { orderId, userId: user.id },
  });
  if (!payment) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    order_id: payment.orderId,
    status: payment.status,
    credited: payment.credited,
    credits: payment.credits,
  });
}
