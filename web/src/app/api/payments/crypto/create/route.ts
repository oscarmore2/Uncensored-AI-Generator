import { NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getCurrentUser } from "@/lib/auth";
import {
  createNowPaymentsInvoice,
  nowPaymentsConfigured,
} from "@/lib/nowpayments";
import { rechargeSchema } from "@/lib/validators";
import { rateLimit } from "@/lib/rate-limit";
import { getCreditPackageByCredits } from "@/lib/pricing";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!(await nowPaymentsConfigured())) {
    return NextResponse.json({ error: "加密货币支付未配置" }, { status: 503 });
  }

  if (!rateLimit(`crypto-pay:${user.id}`, 5, 60_000)) {
    return NextResponse.json({ error: "请求过于频繁，请稍后再试" }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = rechargeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "无效的充值套餐" }, { status: 400 });
  }

  const credits = Number(parsed.data.package);
  const pkg = await getCreditPackageByCredits(credits);
  if (!pkg) {
    return NextResponse.json({ error: "无效的充值套餐" }, { status: 400 });
  }
  const priceCents = pkg.priceCents;
  const orderId = `cr_${user.id}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const amountUsd = (priceCents / 100).toFixed(2);

  const record = await db.nowPayment.create({
    data: {
      userId: user.id,
      orderId,
      credits,
      amountUsdCents: priceCents,
      status: "creating",
    },
  });

  try {
    const { invoice, accountRefId } = await createNowPaymentsInvoice({
      orderId,
      amountUsd,
      callbackUrl: `${env.APP_URL}/api/payments/crypto/webhook`,
      successUrl: `${env.APP_URL}/profile?crypto=success`,
      cancelUrl: `${env.APP_URL}/pricing?crypto=cancelled`,
    });

    await db.nowPayment.update({
      where: { id: record.id },
      data: {
        invoiceId: String(invoice.id),
        status: "waiting",
        nowPaymentsAccountId: accountRefId,
      },
    });

    return NextResponse.json({
      order_id: orderId,
      checkout_url: invoice.invoice_url,
    });
  } catch (err) {
    await db.nowPayment.update({ where: { id: record.id }, data: { status: "create_failed" } });
    console.error("[nowpayments] create invoice error:", err);
    return NextResponse.json({ error: "创建加密支付订单失败，请稍后再试" }, { status: 502 });
  }
}
