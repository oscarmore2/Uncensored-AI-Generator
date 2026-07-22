import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getCurrentUser } from "@/lib/auth";
import { getStripe, stripeConfigured } from "@/lib/stripe";
import { rechargeSchema } from "@/lib/validators";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!rateLimit(`stripe-pay:${user.id}`, 5, 60_000)) {
    return NextResponse.json({ error: "请求过于频繁，请稍后再试" }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = rechargeSchema.safeParse(body);
  if (!parsed.success || !(parsed.data.package in env.CREDIT_PACKAGES)) {
    return NextResponse.json({ error: "无效的充值套餐" }, { status: 400 });
  }

  const priceCents = env.CREDIT_PACKAGES[parsed.data.package];
  const credits = Number(parsed.data.package);

  if (env.DEMO_MODE) {
    const [updated] = await db.$transaction([
      db.user.update({ where: { id: user.id }, data: { balance: { increment: credits } } }),
      db.transaction.create({
        data: { userId: user.id, type: "recharge", amount: credits, priceCents, method: "demo" },
      }),
    ]);
    return NextResponse.json({
      demo: true,
      message: `Demo mode: +${credits} credits added`,
      new_balance: updated.balance,
    });
  }

  if (!(await stripeConfigured())) {
    return NextResponse.json({ error: "Stripe 支付未配置" }, { status: 503 });
  }

  try {
    const { client, accountRefId } = await getStripe();
    const session = await client.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: `AVClubs ${credits} Credits` },
            unit_amount: priceCents,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${env.APP_URL}/profile?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.APP_URL}/profile?checkout=cancel`,
      metadata: {
        user_id: String(user.id),
        credits: String(credits),
        ...(accountRefId ? { stripe_account_ref: String(accountRefId) } : {}),
      },
    });

    return NextResponse.json({ checkout_url: session.url });
  } catch (err) {
    console.error("[stripe] create checkout error:", err);
    return NextResponse.json({ error: "创建 Stripe 支付失败，请稍后再试" }, { status: 502 });
  }
}
