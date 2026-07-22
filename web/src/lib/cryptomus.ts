import "server-only";
import crypto from "crypto";
import { env } from "./env";
import { db } from "./db";
import { sendTelegram } from "./telegram";
import { decryptSecret } from "./secret-crypto";

const API_BASE = "https://api.cryptomus.com/v1";

export interface CryptomusCredentials {
  merchantId: string;
  paymentApiKey: string;
  /** DB 中的商户记录 id；env 兜底时为 null */
  merchantRefId: number | null;
  source: "db" | "env";
  label?: string;
}

/** 优先使用管理端激活的商户；无激活时回退到 .env */
export async function getActiveCryptomusCredentials(): Promise<CryptomusCredentials | null> {
  const active = await db.cryptomusMerchant.findFirst({ where: { isActive: true } });
  if (active) {
    return {
      merchantId: active.merchantId,
      paymentApiKey: decryptSecret(active.paymentApiKeyEnc),
      merchantRefId: active.id,
      source: "db",
      label: active.label,
    };
  }
  if (env.CRYPTOMUS_MERCHANT_ID && env.CRYPTOMUS_PAYMENT_API_KEY) {
    return {
      merchantId: env.CRYPTOMUS_MERCHANT_ID,
      paymentApiKey: env.CRYPTOMUS_PAYMENT_API_KEY,
      merchantRefId: null,
      source: "env",
      label: "env",
    };
  }
  return null;
}

export async function cryptomusConfigured(): Promise<boolean> {
  return Boolean(await getActiveCryptomusCredentials());
}

/** 收集所有可用于 Webhook 验签的 API Key（DB 全部商户 + env） */
async function allPaymentApiKeys(): Promise<string[]> {
  const merchants = await db.cryptomusMerchant.findMany({ select: { paymentApiKeyEnc: true } });
  const keys: string[] = [];
  for (const m of merchants) {
    try {
      keys.push(decryptSecret(m.paymentApiKeyEnc));
    } catch {
      // 坏密文跳过
    }
  }
  if (env.CRYPTOMUS_PAYMENT_API_KEY) keys.push(env.CRYPTOMUS_PAYMENT_API_KEY);
  return [...new Set(keys)];
}

/** 是否具备任意可用于验签的凭证（含未激活商户），Webhook 用 */
export async function cryptomusHasWebhookKeys(): Promise<boolean> {
  const keys = await allPaymentApiKeys();
  return keys.length > 0;
}

function signWithKey(jsonBody: string, paymentApiKey: string): string {
  return crypto
    .createHash("md5")
    .update(Buffer.from(jsonBody).toString("base64") + paymentApiKey)
    .digest("hex");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

interface CryptomusInvoice {
  uuid: string;
  order_id: string;
  amount: string;
  currency: string;
  payment_status: string;
  url: string;
  expired_at: number;
  address: string | null;
  network: string | null;
}

async function cryptomusRequest<T>(
  path: string,
  body: Record<string, unknown>,
  creds: CryptomusCredentials
): Promise<T> {
  const jsonBody = JSON.stringify(body);
  const resp = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      merchant: creds.merchantId,
      sign: signWithKey(jsonBody, creds.paymentApiKey),
      "Content-Type": "application/json",
    },
    body: jsonBody,
  });

  const data = (await resp.json().catch(() => ({}))) as {
    state?: number;
    result?: T;
    message?: string;
    errors?: Record<string, string[]>;
  };

  if (!resp.ok || data.state !== 0 || !data.result) {
    const detail = data.message ?? (data.errors ? JSON.stringify(data.errors) : `HTTP ${resp.status}`);
    throw new Error(`Cryptomus ${path} failed: ${detail}`);
  }
  return data.result;
}

/** 创建托管收银台发票，返回支付页 URL 等信息与所用商户引用 */
export async function createInvoice(params: {
  orderId: string;
  amountUsd: string;
  callbackUrl: string;
  successUrl: string;
  returnUrl: string;
}): Promise<{ invoice: CryptomusInvoice; merchantRefId: number | null }> {
  const creds = await getActiveCryptomusCredentials();
  if (!creds) throw new Error("Cryptomus is not configured");

  const invoice = await cryptomusRequest<CryptomusInvoice>(
    "/payment",
    {
      amount: params.amountUsd,
      currency: "USD",
      order_id: params.orderId,
      url_callback: params.callbackUrl,
      url_success: params.successUrl,
      url_return: params.returnUrl,
      lifetime: 3600,
      currencies: [{ currency: "USDT" }, { currency: "USDC" }],
    },
    creds
  );
  return { invoice, merchantRefId: creds.merchantRefId };
}

/**
 * 验证 Webhook 签名：依次尝试所有已配置商户的 API Key（含 env 兜底），
 * 以便旧订单在切换激活商户后仍能验签入账。
 */
export async function verifyWebhookSignature(
  rawBody: string
): Promise<{ valid: boolean; payload: Record<string, unknown> | null }> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return { valid: false, payload: null };
  }

  const sign = parsed.sign;
  if (typeof sign !== "string") return { valid: false, payload: null };

  const { sign: _omit, ...rest } = parsed;
  const jsonWithoutSign = JSON.stringify(rest).replace(/\//g, "\\/");

  const keys = await allPaymentApiKeys();
  for (const key of keys) {
    const expected = signWithKey(jsonWithoutSign, key);
    if (timingSafeEqualHex(expected, sign)) {
      return { valid: true, payload: rest };
    }
  }
  return { valid: false, payload: null };
}

const SUCCESS_STATUSES = new Set(["paid", "paid_over"]);

export type CreditCryptoOptions = {
  creditsOverride?: number;
  priceCentsOverride?: number;
  methodSuffix?: string;
  skipTelegram?: boolean;
  telegramExtra?: string;
};

/** 将已确认的加密订单入账（Webhook 与 Admin 人工入账共用） */
export async function creditCryptoPayment(
  payment: {
    id: number;
    orderId: string;
    userId: number;
    credits: number;
    amountUsdCents: number;
    credited: boolean;
  },
  opts: CreditCryptoOptions = {}
): Promise<boolean> {
  if (payment.credited) return false;

  const credits = opts.creditsOverride ?? payment.credits;
  const priceCents = opts.priceCentsOverride ?? payment.amountUsdCents;
  if (credits <= 0) return false;

  const claimed = await db.cryptoPayment.updateMany({
    where: { orderId: payment.orderId, credited: false },
    data: { credited: true },
  });
  if (claimed.count === 0) return false;

  const method = opts.methodSuffix ? `cryptomus:${opts.methodSuffix}` : "cryptomus";

  await db.$transaction([
    db.user.update({
      where: { id: payment.userId },
      data: { balance: { increment: credits } },
    }),
    db.transaction.create({
      data: {
        userId: payment.userId,
        type: "recharge",
        amount: credits,
        priceCents,
        stripePaymentId: null,
        method,
      },
    }),
  ]);

  if (!opts.skipTelegram) {
    const extra = opts.telegramExtra ? `\n${opts.telegramExtra}` : "";
    sendTelegram(
      `🪙 加密货币充值成功\n用户 ID: ${payment.userId}\n点数: +${credits}\n金额: $${(priceCents / 100).toFixed(2)}${extra}`
    );
  }
  return true;
}

export async function settleCryptoPayment(params: {
  orderId: string;
  status: string;
  txid: string | null;
  network: string | null;
  payerCurrency: string | null;
}): Promise<boolean> {
  const { orderId, status, txid, network, payerCurrency } = params;

  const payment = await db.cryptoPayment.findUnique({ where: { orderId } });
  if (!payment) return false;

  await db.cryptoPayment.update({
    where: { orderId },
    data: { status, txid, network, payerCurrency },
  });

  if (!SUCCESS_STATUSES.has(status) || payment.credited) return false;

  const ok = await creditCryptoPayment(payment, {
    telegramExtra: `币种: ${payerCurrency ?? "?"} (${network ?? "?"})`,
  });
  return ok;
}
