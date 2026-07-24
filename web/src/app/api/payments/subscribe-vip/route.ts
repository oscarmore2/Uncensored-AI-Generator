import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getCurrentUser } from "@/lib/auth";
import { getStripe, stripeConfigured } from "@/lib/stripe";
import { rateLimit } from "@/lib/rate-limit";
import { getDefaultVipPlan, getVipPlanById } from "@/lib/pricing";

const bodySchema = z.object({
  plan_id: z.number().int().positive().optional(),
});

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!rateLimit(`vip-subscribe:${user.id}`, 3, 60_000)) {
    return NextResponse.json({ error: "请求过于频繁，请稍后再试" }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "参数无效" }, { status: 400 });
  }

  const plan = parsed.data.plan_id
    ? await getVipPlanById(parsed.data.plan_id)
    : await getDefaultVipPlan();
  if (!plan) {
    return NextResponse.json({ error: "暂无可用的 VIP 套餐" }, { status: 400 });
  }

  if (env.DEMO_MODE) {
    const expires = new Date(Date.now() + plan.durationDays * 24 * 60 * 60 * 1000);
    const [updated] = await db.$transaction([
      db.user.update({
        where: { id: user.id },
        data: {
          isVip: true,
          vipExpiresAt: expires,
          vipTierId: plan.tierId,
          balance: { increment: plan.bonusCredits },
        },
      }),
      db.transaction.create({
        data: {
          userId: user.id,
          type: "vip",
          amount: plan.bonusCredits,
          priceCents: plan.priceCents,
          method: "demo",
        },
      }),
    ]);
    return NextResponse.json({
      message: "VIP activated (demo)",
      new_balance: updated.balance,
      plan_id: plan.id,
      tier: plan.tier.code,
    });
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
            product_data: { name: `玩玩可物 ${plan.label}` },
            unit_amount: plan.priceCents,
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
        vip_plan_id: String(plan.id),
        vip_tier_id: String(plan.tierId),
        bonus_credits: String(plan.bonusCredits),
        duration_days: String(plan.durationDays),
        ...(accountRefId ? { stripe_account_ref: String(accountRefId) } : {}),
      },
      subscription_data: {
        metadata: {
          user_id: String(user.id),
          type: "vip",
          vip_plan_id: String(plan.id),
          vip_tier_id: String(plan.tierId),
        },
      },
    });

    return NextResponse.json({ checkout_url: session.url });
  } catch (err) {
    console.error("[stripe] vip checkout error:", err);
    return NextResponse.json({ error: "创建 VIP 订阅失败，请稍后再试" }, { status: 502 });
  }
}
