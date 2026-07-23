import { NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getCurrentUser } from "@/lib/auth";
import { createInvoice, cryptomusConfigured } from "@/lib/cryptomus";
import { rechargeSchema } from "@/lib/validators";
import { rateLimit } from "@/lib/rate-limit";
import { getCreditPackageByCredits } from "@/lib/pricing";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!(await cryptomusConfigured())) {
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

  const record = await db.cryptoPayment.create({
    data: {
      userId: user.id,
      orderId,
      credits,
      amountUsdCents: priceCents,
      status: "check",
    },
  });

  try {
    const { invoice, merchantRefId } = await createInvoice({
      orderId,
      amountUsd,
      callbackUrl: `${env.APP_URL}/api/payments/crypto/webhook`,
      successUrl: `${env.APP_URL}/profile?crypto=success`,
      returnUrl: `${env.APP_URL}/profile?crypto=return`,
    });

    await db.cryptoPayment.update({
      where: { id: record.id },
      data: {
        invoiceUuid: invoice.uuid,
        status: invoice.payment_status,
        merchantRefId,
      },
    });

    return NextResponse.json({
      order_id: orderId,
      checkout_url: invoice.url,
      expired_at: invoice.expired_at,
    });
  } catch (err) {
    await db.cryptoPayment.update({ where: { id: record.id }, data: { status: "create_failed" } });
    console.error("[cryptomus] create invoice error:", err);
    return NextResponse.json({ error: "创建加密支付订单失败，请稍后再试" }, { status: 502 });
  }
}
