import { NextResponse } from "next/server";
import Stripe from "stripe";
import { db } from "@/lib/db";
import { constructStripeEvent, stripeHasWebhookSecrets } from "@/lib/stripe";
import { sendTelegram } from "@/lib/telegram";
import { logWebhookEvent } from "@/lib/webhook-log";

const VIP_BONUS_CREDITS = 800;

async function activateVip(userId: number, expiresAt: Date, stripeAccountRefId: number | null, sessionId: string) {
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
        balance: { increment: VIP_BONUS_CREDITS },
      },
    }),
    db.transaction.create({
      data: {
        userId,
        type: "vip",
        amount: VIP_BONUS_CREDITS,
        priceCents: null,
        stripePaymentId: sessionId,
        method: "stripe",
        stripeAccountRefId,
      },
    }),
  ]);
  sendTelegram(`👑 VIP 订阅激活\n用户 ID: ${userId}\n赠送点数: +${VIP_BONUS_CREDITS}`);
}

async function revokeVip(userId: number) {
  await db.user.update({
    where: { id: userId },
    data: { isVip: false, vipExpiresAt: null },
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
          const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
          await activateVip(userId, expires, stripeAccountRefId, session.id);
          await logWebhookEvent({
            provider: "stripe",
            eventType: event.type,
            externalId: session.id,
            status: "ok",
            detail: { user_id: userId, type: "vip" },
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
          const paymentId = typeof session.payment_intent === "string" ? session.payment_intent : null;
          const existing = paymentId
            ? await db.transaction.findFirst({ where: { stripePaymentId: paymentId } })
            : null;
          if (!existing) {
            await db.$transaction([
              db.user.update({ where: { id: userId }, data: { balance: { increment: credits } } }),
              db.transaction.create({
                data: {
                  userId,
                  type: "recharge",
                  amount: credits,
                  priceCents: session.amount_total,
                  stripePaymentId: paymentId,
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
            detail: { user_id: userId, credits },
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
