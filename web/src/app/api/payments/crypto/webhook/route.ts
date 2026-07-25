import { NextResponse } from "next/server";
import {
  nowPaymentsConfigured,
  settleNowPayment,
  verifyNowPaymentsIpn,
} from "@/lib/nowpayments";
import { logWebhookEvent } from "@/lib/webhook-log";

export async function POST(req: Request) {
  if (!nowPaymentsConfigured()) {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  const { rateLimit, clientIp } = await import("@/lib/rate-limit");
  if (!rateLimit(`nowpayments-webhook:${clientIp(req)}`, 120, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const rawBody = await req.text();
  const { valid, payload } = verifyNowPaymentsIpn(
    rawBody,
    req.headers.get("x-nowpayments-sig")
  );
  if (!valid || !payload) {
    await logWebhookEvent({
      provider: "nowpayments",
      status: "error",
      detail: "invalid IPN signature",
    });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const orderId = typeof payload.order_id === "string" ? payload.order_id : null;
  const status =
    typeof payload.payment_status === "string" ? payload.payment_status : null;
  if (!orderId || !status) {
    await logWebhookEvent({
      provider: "nowpayments",
      eventType: status ?? undefined,
      externalId: orderId ?? undefined,
      status: "error",
      detail: "malformed payload",
    });
    return NextResponse.json({ error: "Malformed payload" }, { status: 400 });
  }

  try {
    const credited = await settleNowPayment({
      orderId,
      invoiceId:
        typeof payload.invoice_id === "string" || typeof payload.invoice_id === "number"
          ? String(payload.invoice_id)
          : null,
      paymentId:
        typeof payload.payment_id === "string" || typeof payload.payment_id === "number"
          ? String(payload.payment_id)
          : null,
      status,
      priceAmount:
        typeof payload.price_amount === "number"
          ? payload.price_amount
          : typeof payload.price_amount === "string"
            ? Number(payload.price_amount)
            : null,
      priceCurrency:
        typeof payload.price_currency === "string" ? payload.price_currency : null,
      actuallyPaid:
        typeof payload.actually_paid === "string" || typeof payload.actually_paid === "number"
          ? String(payload.actually_paid)
          : null,
      payCurrency:
        typeof payload.pay_currency === "string" ? payload.pay_currency : null,
      network: typeof payload.network === "string" ? payload.network : null,
      txHash:
        typeof payload.payin_hash === "string"
          ? payload.payin_hash
          : typeof payload.outcome_hash === "string"
            ? payload.outcome_hash
            : null,
    });

    await logWebhookEvent({
      provider: "nowpayments",
      eventType: status,
      externalId: orderId,
      status: credited ? "ok" : "ignored",
      detail: { credited },
    });

    if (credited) {
      console.log(`[nowpayments] order ${orderId} credited (status=${status})`);
    }
  } catch (error) {
    await logWebhookEvent({
      provider: "nowpayments",
      eventType: status,
      externalId: orderId,
      status: "error",
      detail: String(error),
    });
    throw error;
  }

  return NextResponse.json({ ok: true });
}
