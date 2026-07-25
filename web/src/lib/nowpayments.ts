import "server-only";
import { db } from "./db";
import { env } from "./env";
import { sendTelegram } from "./telegram";
import {
  type JsonValue,
  verifyNowPaymentsSignature,
} from "./nowpayments-signature";
import { decryptSecret } from "./secret-crypto";

export interface NowPaymentsInvoice {
  id: string | number;
  order_id: string;
  price_amount: string | number;
  price_currency: string;
  invoice_url: string;
  created_at?: string;
  updated_at?: string;
}

export interface NowPaymentsCredentials {
  apiKey: string;
  ipnSecret: string;
  baseUrl: string;
  accountRefId: number | null;
  source: "db" | "env";
  label: string;
}

function normalizedBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

/** 管理端激活配置优先；没有可用的 DB 配置时才读取 env。 */
export async function getActiveNowPaymentsCredentials(): Promise<NowPaymentsCredentials | null> {
  const active = await db.nowPaymentsAccount.findFirst({
    where: { isActive: true },
    orderBy: { updatedAt: "desc" },
  });
  if (active) {
    try {
      return {
        apiKey: decryptSecret(active.apiKeyEnc),
        ipnSecret: decryptSecret(active.ipnSecretEnc),
        baseUrl: normalizedBaseUrl(active.baseUrl),
        accountRefId: active.id,
        source: "db",
        label: active.label,
      };
    } catch (error) {
      console.error("[nowpayments] unable to decrypt active DB configuration", error);
    }
  }
  if (env.NOWPAYMENTS_API_KEY || env.NOWPAYMENTS_IPN_SECRET) {
    return {
      apiKey: env.NOWPAYMENTS_API_KEY,
      ipnSecret: env.NOWPAYMENTS_IPN_SECRET,
      baseUrl: normalizedBaseUrl(env.NOWPAYMENTS_BASE_URL),
      accountRefId: null,
      source: "env",
      label: "env fallback",
    };
  }
  return null;
}

export async function nowPaymentsConfigured(): Promise<boolean> {
  const credentials = await getActiveNowPaymentsCredentials();
  return Boolean(credentials?.apiKey && credentials.ipnSecret);
}

async function nowPaymentsRequest<T>(
  path: string,
  init: { method?: "GET" | "POST"; body?: Record<string, unknown> } = {},
  providedCredentials?: NowPaymentsCredentials
): Promise<T> {
  const credentials =
    providedCredentials ?? (await getActiveNowPaymentsCredentials());
  if (!credentials?.apiKey) throw new Error("NOWPayments API key is not configured");
  const response = await fetch(`${credentials.baseUrl}${path}`, {
    method: init.method ?? "GET",
    headers: {
      "x-api-key": credentials.apiKey,
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
}): Promise<{ invoice: NowPaymentsInvoice; accountRefId: number | null }> {
  const credentials = await getActiveNowPaymentsCredentials();
  if (!credentials?.apiKey || !credentials.ipnSecret) {
    throw new Error("NOWPayments is not fully configured");
  }
  const invoice = await nowPaymentsRequest<NowPaymentsInvoice>("/invoice", {
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
  }, credentials);
  return { invoice, accountRefId: credentials.accountRefId };
}

async function allNowPaymentsIpnSecrets(): Promise<string[]> {
  const accounts = await db.nowPaymentsAccount.findMany({
    select: { ipnSecretEnc: true },
  });
  const secrets: string[] = [];
  for (const account of accounts) {
    try {
      const secret = decryptSecret(account.ipnSecretEnc);
      if (secret) secrets.push(secret);
    } catch {
      // Skip unreadable stored credentials and continue with the remaining candidates.
    }
  }
  if (env.NOWPAYMENTS_IPN_SECRET) secrets.push(env.NOWPAYMENTS_IPN_SECRET);
  return [...new Set(secrets)];
}

export async function verifyNowPaymentsIpn(
  rawBody: string,
  receivedSignature: string | null
): Promise<{ valid: boolean; payload: Record<string, JsonValue> | null }> {
  if (!receivedSignature) {
    return { valid: false, payload: null };
  }
  let payload: Record<string, JsonValue>;
  try {
    payload = JSON.parse(rawBody) as Record<string, JsonValue>;
  } catch {
    return { valid: false, payload: null };
  }
  const secrets = await allNowPaymentsIpnSecrets();
  return {
    valid: secrets.some((secret) =>
      verifyNowPaymentsSignature(payload, secret, receivedSignature)
    ),
    payload,
  };
}

export async function testNowPaymentsCredentials(params: {
  apiKey: string;
  ipnSecret: string;
  baseUrl: string;
}): Promise<void> {
  if (!params.apiKey || !params.ipnSecret) {
    throw new Error("API Key 与 IPN Secret 均为必填");
  }
  await nowPaymentsRequest<Record<string, unknown>>(
    "/balance",
    { method: "GET" },
    {
      apiKey: params.apiKey,
      ipnSecret: params.ipnSecret,
      baseUrl: normalizedBaseUrl(params.baseUrl),
      accountRefId: null,
      source: "db",
      label: "test",
    }
  );
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
