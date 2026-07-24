import { NextResponse } from "next/server";
import { verifyWebhookSignature, settleCryptoPayment, cryptomusHasWebhookKeys } from "@/lib/cryptomus";
import { logWebhookEvent } from "@/lib/webhook-log";

const CRYPTOMUS_IPS = new Set(["91.227.144.54"]);

export async function POST(req: Request) {
  if (!(await cryptomusHasWebhookKeys())) {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  const { rateLimit, clientIp } = await import("@/lib/rate-limit");
  if (!rateLimit(`cryptomus-webhook:${clientIp(req)}`, 120, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const rawBody = await req.text();
  const { valid, payload } = await verifyWebhookSignature(rawBody);
  if (!valid || !payload) {
    await logWebhookEvent({ provider: "cryptomus", status: "error", detail: "invalid signature" });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0].trim();
  if (fwd && !CRYPTOMUS_IPS.has(fwd)) {
    console.warn(`[cryptomus] webhook from unexpected IP: ${fwd} (signature was valid)`);
    await logWebhookEvent({
      provider: "cryptomus",
      eventType: typeof payload.status === "string" ? payload.status : undefined,
      externalId: typeof payload.order_id === "string" ? payload.order_id : undefined,
      status: "ignored",
      detail: { reason: "unexpected_ip", ip: fwd },
    });
    // 签名已通过则仍入账（官方可能经 CDN）；异常 IP 记审计便于排查
  }

  const orderId = typeof payload.order_id === "string" ? payload.order_id : null;
  const status = typeof payload.status === "string" ? payload.status : null;
  if (!orderId || !status) {
    await logWebhookEvent({
      provider: "cryptomus",
      eventType: status ?? undefined,
      externalId: orderId ?? undefined,
      status: "error",
      detail: "malformed payload",
    });
    return NextResponse.json({ error: "Malformed payload" }, { status: 400 });
  }

  try {
    const credited = await settleCryptoPayment({
      orderId,
      status,
      txid: typeof payload.txid === "string" ? payload.txid : null,
      network: typeof payload.network === "string" ? payload.network : null,
      payerCurrency: typeof payload.payer_currency === "string" ? payload.payer_currency : null,
    });

    await logWebhookEvent({
      provider: "cryptomus",
      eventType: status,
      externalId: orderId,
      status: credited ? "ok" : "ignored",
      detail: { credited },
    });

    if (credited) {
      console.log(`[cryptomus] order ${orderId} credited (status=${status})`);
    }
  } catch (err) {
    await logWebhookEvent({
      provider: "cryptomus",
      eventType: status,
      externalId: orderId,
      status: "error",
      detail: String(err),
    });
    throw err;
  }

  return NextResponse.json({ ok: true });
}
