import { NextResponse } from "next/server";
import Stripe from "stripe";
import { db } from "@/lib/db";
import { constructStripeEvent, stripeHasWebhookSecrets } from "@/lib/stripe";
import { sendTelegram } from "@/lib/telegram";
import { logWebhookEvent } from "@/lib/webhook-log";
import { getDefaultVipPlan, getVipPlanById } from "@/lib/pricing";

async function activateVip(
  userId: number,
  expiresAt: Date,
  stripeAccountRefId: number | null,
  sessionId: string,
  opts: { bonusCredits: number; priceCents: number | null; vipTierId: number | null }
) {
  const existing = await db.transaction.findFirst({
    where: { userId, type: "vip", stripePaymentId: sessionId },
  });
  if (existing) return;

  await db.$transaction([
    db.user.update({
      where: { id: userId },
      data: {
        isVip: true,
        vipExpiresAt: expiresAt,
        vipTierId: opts.vipTierId,
        balance: { increment: opts.bonusCredits },
      },
    }),
    db.transaction.create({
      data: {
        userId,
        type: "vip",
        amount: opts.bonusCredits,
        priceCents: opts.priceCents,
        stripePaymentId: sessionId,
        method: "stripe",
        stripeAccountRefId,
      },
    }),
  ]);
  sendTelegram(`👑 VIP 订阅激活\n用户 ID: ${userId}\n赠送点数: +${opts.bonusCredits}`);
}

async function revokeVip(userId: number) {
  await db.user.update({
    where: { id: userId },
    data: { isVip: false, vipExpiresAt: null, vipTierId: null },
  });
  sendTelegram(`👑 VIP 订阅已取消\n用户 ID: ${userId}`);
}

function userIdFromMeta(meta: Stripe.Metadata | null | undefined): number | null {
  const raw = meta?.user_id;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function POST(req: Request) {
  if (!(await stripeHasWebhookSecrets())) {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  const { rateLimit, clientIp } = await import("@/lib/rate-limit");
  if (!rateLimit(`stripe-webhook:${clientIp(req)}`, 120, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const payload = await req.text();
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    await logWebhookEvent({ provider: "stripe", status: "error", detail: "missing signature" });
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const verified = await constructStripeEvent(payload, signature);
  if (!verified) {
    await logWebhookEvent({ provider: "stripe", status: "error", detail: "verification failed" });
    return NextResponse.json({ error: "Webhook verification failed" }, { status: 400 });
  }
  const { event, accountRefId } = verified;

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const metaType = session.metadata?.type;

      if (metaType === "vip") {
        const userId = userIdFromMeta(session.metadata);
        if (userId) {
          const metaRef = Number(session.metadata?.stripe_account_ref);
          const stripeAccountRefId =
            Number.isInteger(metaRef) && metaRef > 0 ? metaRef : accountRefId;
          const planId = Number(session.metadata?.vip_plan_id);
          const plan = Number.isInteger(planId) && planId > 0
            ? await getVipPlanById(planId)
            : await getDefaultVipPlan();
          const durationDays = Number(session.metadata?.duration_days) || plan?.durationDays || 30;
          const bonusCredits =
            Number(session.metadata?.bonus_credits) || plan?.bonusCredits || 0;
          const vipTierId =
            Number(session.metadata?.vip_tier_id) || plan?.tierId || null;
          const expires = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);
          await activateVip(userId, expires, stripeAccountRefId, session.id, {
            bonusCredits,
            priceCents: plan?.priceCents ?? null,
            vipTierId: Number.isInteger(vipTierId) && (vipTierId as number) > 0 ? (vipTierId as number) : null,
          });
          await logWebhookEvent({
            provider: "stripe",
            eventType: event.type,
            externalId: session.id,
            status: "ok",
            detail: { user_id: userId, type: "vip", vip_plan_id: plan?.id ?? null },
          });
        } else {
          await logWebhookEvent({
            provider: "stripe",
            eventType: event.type,
            externalId: session.id,
            status: "ignored",
            detail: "vip missing user_id",
          });
        }
      } else {
        const userId = Number(session.metadata?.user_id);
        const credits = Number(session.metadata?.credits);
        const metaRef = Number(session.metadata?.stripe_account_ref);
        const stripeAccountRefId =
          Number.isInteger(metaRef) && metaRef > 0 ? metaRef : accountRefId;

        if (Number.isInteger(userId) && Number.isInteger(credits) && credits > 0) {
          // 幂等键：优先 payment_intent，否则用 session.id（避免 null 导致重复入账）
          const paymentIntentId =
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : session.payment_intent && typeof session.payment_intent === "object" && "id" in session.payment_intent
                ? String((session.payment_intent as { id: string }).id)
                : null;
          const idempotencyKey = paymentIntentId || `cs_${session.id}`;

          // 金额校验：metadata.credits 对应套餐价须与实付一致（允许 1 美分误差）
          const { env } = await import("@/lib/env");
          const expectedCents = env.CREDIT_PACKAGES[String(credits)];
          if (expectedCents && session.amount_total != null) {
            if (Math.abs(session.amount_total - expectedCents) > 1) {
              await logWebhookEvent({
                provider: "stripe",
                eventType: event.type,
                externalId: session.id,
                status: "error",
                detail: {
                  reason: "amount_mismatch",
                  expected: expectedCents,
                  actual: session.amount_total,
                  credits,
                },
              });
              sendTelegram(
                `⚠️ Stripe 金额不符，已拒绝入账\nsession: ${session.id}\n期望 $${(expectedCents / 100).toFixed(2)} / 实付 $${((session.amount_total ?? 0) / 100).toFixed(2)}`
              );
              return NextResponse.json({ status: "amount_mismatch" }, { status: 400 });
            }
          }

          const existing = await db.transaction.findFirst({
            where: {
              OR: [{ stripePaymentId: idempotencyKey }, { stripePaymentId: session.id }],
            },
          });
          if (!existing) {
            await db.$transaction([
              db.user.update({ where: { id: userId }, data: { balance: { increment: credits } } }),
              db.transaction.create({
                data: {
                  userId,
                  type: "recharge",
                  amount: credits,
                  priceCents: session.amount_total,
                  stripePaymentId: idempotencyKey,
                  method: "stripe",
                  stripeAccountRefId,
                },
              }),
            ]);
            sendTelegram(
              `💳 Stripe 充值成功\n用户 ID: ${userId}\n点数: +${credits}\n金额: $${((session.amount_total ?? 0) / 100).toFixed(2)}`
            );
          }
          await logWebhookEvent({
            provider: "stripe",
            eventType: event.type,
            externalId: session.id,
            status: "ok",
            detail: { user_id: userId, credits, idempotency_key: idempotencyKey },
          });
        } else {
          await logWebhookEvent({
            provider: "stripe",
            eventType: event.type,
            externalId: session.id,
            status: "ignored",
          });
        }
      }
    } else if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object as Stripe.Subscription;
      const userId = userIdFromMeta(sub.metadata);
      if (userId) {
        await revokeVip(userId);
        await logWebhookEvent({
          provider: "stripe",
          eventType: event.type,
          externalId: sub.id,
          status: "ok",
          detail: { user_id: userId },
        });
      } else {
        await logWebhookEvent({
          provider: "stripe",
          eventType: event.type,
          externalId: sub.id,
          status: "ignored",
        });
      }
    } else {
      await logWebhookEvent({
        provider: "stripe",
        eventType: event.type,
        externalId: event.id,
        status: "ignored",
      });
    }
  } catch (err) {
    await logWebhookEvent({
      provider: "stripe",
      eventType: event.type,
      externalId: event.id,
      status: "error",
      detail: String(err),
    });
    throw err;
  }

  return NextResponse.json({ status: "success" });
}
