import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getCurrentUser } from "@/lib/auth";
import { getStripe, stripeConfigured } from "@/lib/stripe";
import { rateLimit } from "@/lib/rate-limit";

const VIP_BONUS_CREDITS = 800;

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!rateLimit(`vip-subscribe:${user.id}`, 3, 60_000)) {
    return NextResponse.json({ error: "请求过于频繁，请稍后再试" }, { status: 429 });
  }

  if (env.DEMO_MODE) {
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const [updated] = await db.$transaction([
      db.user.update({
        where: { id: user.id },
        data: { isVip: true, vipExpiresAt: expires, balance: { increment: VIP_BONUS_CREDITS } },
      }),
      db.transaction.create({
        data: { userId: user.id, type: "vip", amount: VIP_BONUS_CREDITS, priceCents: env.VIP_PRICE, method: "demo" },
      }),
    ]);
    return NextResponse.json({ message: "VIP activated (demo)", new_balance: updated.balance });
  }

  if (!(await stripeConfigured())) {
    return NextResponse.json({ error: "Stripe 支付未配置" }, { status: 503 });
  }

  try {
    const { client, accountRefId } = await getStripe();
    const session = await client.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "subscription",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: "AVClubs VIP Monthly" },
            unit_amount: env.VIP_PRICE,
            recurring: { interval: "month" },
          },
          quantity: 1,
        },
      ],
      success_url: `${env.APP_URL}/profile?vip=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.APP_URL}/profile?vip=cancel`,
      metadata: {
        user_id: String(user.id),
        type: "vip",
        ...(accountRefId ? { stripe_account_ref: String(accountRefId) } : {}),
      },
      subscription_data: {
        metadata: {
          user_id: String(user.id),
          type: "vip",
        },
      },
    });

    return NextResponse.json({ checkout_url: session.url });
  } catch (err) {
    console.error("[stripe] vip checkout error:", err);
    return NextResponse.json({ error: "创建 VIP 订阅失败，请稍后再试" }, { status: 502 });
  }
}
