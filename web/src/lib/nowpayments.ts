import "server-only";
import { db } from "./db";
import { env } from "./env";
import { sendTelegram } from "./telegram";
import {
  type JsonValue,
  verifyNowPaymentsSignature,
} from "./nowpayments-signature";

export interface NowPaymentsInvoice {
  id: string | number;
  order_id: string;
  price_amount: string | number;
  price_currency: string;
  invoice_url: string;
  created_at?: string;
  updated_at?: string;
}

export function nowPaymentsConfigured(): boolean {
  return Boolean(env.NOWPAYMENTS_API_KEY && env.NOWPAYMENTS_IPN_SECRET);
}

async function nowPaymentsRequest<T>(
  path: string,
  init: { method?: "GET" | "POST"; body?: Record<string, unknown> } = {}
): Promise<T> {
  if (!env.NOWPAYMENTS_API_KEY) throw new Error("NOWPayments API key is not configured");
  const response = await fetch(`${env.NOWPAYMENTS_BASE_URL}${path}`, {
    method: init.method ?? "GET",
    headers: {
      "x-api-key": env.NOWPAYMENTS_API_KEY,
      "Content-Type": "application/json",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await response.json().catch(() => ({}))) as T & {
    message?: string;
    code?: string;
  };
  if (!response.ok) {
    const detail = data.message ?? data.code ?? `HTTP ${response.status}`;
    throw new Error(`NOWPayments ${path} failed: ${detail}`);
  }
  return data;
}

export async function createNowPaymentsInvoice(params: {
  orderId: string;
  amountUsd: string;
  callbackUrl: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<NowPaymentsInvoice> {
  return nowPaymentsRequest<NowPaymentsInvoice>("/invoice", {
    method: "POST",
    body: {
      price_amount: params.amountUsd,
      price_currency: "usd",
      order_id: params.orderId,
      order_description: `玩玩可物 credits order ${params.orderId}`,
      ipn_callback_url: params.callbackUrl,
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      partially_paid_url: params.cancelUrl,
      is_fixed_rate: true,
      is_fee_paid_by_user: false,
    },
  });
}

export function verifyNowPaymentsIpn(
  rawBody: string,
  receivedSignature: string | null
): { valid: boolean; payload: Record<string, JsonValue> | null } {
  if (!env.NOWPAYMENTS_IPN_SECRET || !receivedSignature) {
    return { valid: false, payload: null };
  }
  let payload: Record<string, JsonValue>;
  try {
    payload = JSON.parse(rawBody) as Record<string, JsonValue>;
  } catch {
    return { valid: false, payload: null };
  }
  return {
    valid: verifyNowPaymentsSignature(
      payload,
      env.NOWPAYMENTS_IPN_SECRET,
      receivedSignature
    ),
    payload,
  };
}

export type CreditNowPaymentOptions = {
  creditsOverride?: number;
  priceCentsOverride?: number;
  methodSuffix?: string;
  skipTelegram?: boolean;
  telegramExtra?: string;
};

/** Webhook 与管理员人工处理共用；credited 的原子占位保证不会重复加点。 */
export async function creditNowPayment(
  payment: {
    id: number;
    orderId: string;
    userId: number;
    credits: number;
    amountUsdCents: number;
    credited: boolean;
  },
  options: CreditNowPaymentOptions = {}
): Promise<boolean> {
  if (payment.credited) return false;
  const credits = options.creditsOverride ?? payment.credits;
  const priceCents = options.priceCentsOverride ?? payment.amountUsdCents;
  if (credits <= 0 || priceCents < 0) return false;

  const method = options.methodSuffix
    ? `nowpayments:${options.methodSuffix}`
    : "nowpayments";
  const credited = await db.$transaction(async (tx) => {
    const claimed = await tx.nowPayment.updateMany({
      where: { orderId: payment.orderId, credited: false },
      data: { credited: true },
    });
    if (claimed.count === 0) return false;
    await tx.user.update({
      where: { id: payment.userId },
      data: { balance: { increment: credits } },
    });
    await tx.transaction.create({
      data: {
        userId: payment.userId,
        type: "recharge",
        amount: credits,
        priceCents,
        stripePaymentId: null,
        method,
      },
    });
    return true;
  });
  if (!credited) return false;

  if (!options.skipTelegram) {
    const extra = options.telegramExtra ? `\n${options.telegramExtra}` : "";
    void sendTelegram(
      `🪙 NOWPayments 充值成功\n用户 ID: ${payment.userId}\n点数: +${credits}\n金额: $${(priceCents / 100).toFixed(2)}${extra}`
    );
  }
  return true;
}

export async function settleNowPayment(params: {
  orderId: string;
  invoiceId: string | null;
  paymentId: string | null;
  status: string;
  priceAmount: number | null;
  priceCurrency: string | null;
  actuallyPaid: string | null;
  payCurrency: string | null;
  network: string | null;
  txHash: string | null;
}): Promise<boolean> {
  const payment = await db.nowPayment.findUnique({ where: { orderId: params.orderId } });
  if (!payment) return false;

  const receivedCents =
    params.priceAmount !== null && Number.isFinite(params.priceAmount)
      ? Math.round(params.priceAmount * 100)
      : null;
  const amountMatches =
    receivedCents !== null &&
    receivedCents === payment.amountUsdCents &&
    params.priceCurrency?.toLowerCase() === "usd";
  const storedStatus = amountMatches ? params.status : "amount_mismatch";

  await db.nowPayment.update({
    where: { orderId: params.orderId },
    data: {
      invoiceId: params.invoiceId ?? payment.invoiceId,
      paymentId: params.paymentId ?? payment.paymentId,
      status: storedStatus,
      actuallyPaid: params.actuallyPaid,
      payCurrency: params.payCurrency,
      network: params.network,
      txHash: params.txHash,
    },
  });

  if (params.status !== "finished" || !amountMatches || payment.credited) return false;
  return creditNowPayment(payment, {
    telegramExtra: `币种: ${params.payCurrency ?? "?"}${params.network ? ` (${params.network})` : ""}`,
  });
}
