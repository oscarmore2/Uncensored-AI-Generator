import "server-only";
import Stripe from "stripe";
import { env } from "./env";
import { db } from "./db";
import { decryptSecret } from "./secret-crypto";

export interface StripeCredentials {
  secretKey: string;
  webhookSecret: string;
  publishableKey: string | null;
  accountRefId: number | null;
  source: "db" | "env";
  label?: string;
}

/** 优先使用管理端激活的 Stripe 账户；无激活时回退到 .env */
export async function getActiveStripeCredentials(): Promise<StripeCredentials | null> {
  const active = await db.stripeAccount.findFirst({ where: { isActive: true } });
  if (active) {
    return {
      secretKey: decryptSecret(active.secretKeyEnc),
      webhookSecret: decryptSecret(active.webhookSecretEnc),
      publishableKey: active.publishableKey,
      accountRefId: active.id,
      source: "db",
      label: active.label,
    };
  }
  if (env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET) {
    return {
      secretKey: env.STRIPE_SECRET_KEY,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET,
      publishableKey: null,
      accountRefId: null,
      source: "env",
      label: "env",
    };
  }
  // 仅有 secret、无 webhook 时仍可用于创建 Checkout（Webhook 验签另议）
  if (env.STRIPE_SECRET_KEY) {
    return {
      secretKey: env.STRIPE_SECRET_KEY,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET || "",
      publishableKey: null,
      accountRefId: null,
      source: "env",
      label: "env",
    };
  }
  return null;
}

export async function stripeConfigured(): Promise<boolean> {
  const creds = await getActiveStripeCredentials();
  return Boolean(creds?.secretKey);
}

/** 是否具备任意可用于 Webhook 验签的 secret（含未激活账户） */
export async function stripeHasWebhookSecrets(): Promise<boolean> {
  const secrets = await allWebhookSecrets();
  return secrets.length > 0;
}

async function allWebhookSecrets(): Promise<{ secretKey: string; webhookSecret: string; accountRefId: number | null }[]> {
  const accounts = await db.stripeAccount.findMany({
    select: { id: true, secretKeyEnc: true, webhookSecretEnc: true },
  });
  const list: { secretKey: string; webhookSecret: string; accountRefId: number | null }[] = [];
  for (const a of accounts) {
    try {
      list.push({
        secretKey: decryptSecret(a.secretKeyEnc),
        webhookSecret: decryptSecret(a.webhookSecretEnc),
        accountRefId: a.id,
      });
    } catch {
      // 坏密文跳过
    }
  }
  if (env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET) {
    list.push({
      secretKey: env.STRIPE_SECRET_KEY,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET,
      accountRefId: null,
    });
  }
  return list;
}

export function createStripeClient(secretKey: string): Stripe {
  return new Stripe(secretKey);
}

/** 用当前激活凭证创建 Stripe SDK 客户端 */
export async function getStripe(): Promise<{ client: Stripe; accountRefId: number | null }> {
  const creds = await getActiveStripeCredentials();
  if (!creds?.secretKey) {
    throw new Error("Stripe is not configured");
  }
  return { client: createStripeClient(creds.secretKey), accountRefId: creds.accountRefId };
}

/**
 * 用所有已配置账户的 webhook secret 尝试验签。
 * 切换激活账户后，旧账户发出的 Webhook 仍可验签入账。
 */
export async function constructStripeEvent(
  payload: string,
  signature: string
): Promise<{ event: Stripe.Event; accountRefId: number | null } | null> {
  const candidates = await allWebhookSecrets();
  for (const c of candidates) {
    if (!c.webhookSecret) continue;
    try {
      const client = createStripeClient(c.secretKey);
      const event = client.webhooks.constructEvent(payload, signature, c.webhookSecret);
      return { event, accountRefId: c.accountRefId };
    } catch {
      // 尝试下一个
    }
  }
  return null;
}
