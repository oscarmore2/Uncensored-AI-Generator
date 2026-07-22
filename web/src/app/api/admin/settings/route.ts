import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { requireRole } from "@/lib/auth";
import { telegramConfigured } from "@/lib/telegram";
import { cryptomusConfigured } from "@/lib/cryptomus";
import { stripeConfigured } from "@/lib/stripe";
import { ossConfigured } from "@/lib/oss";

/** 只读配置快照（脱敏，不返回 secret 明文） */
export async function GET() {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [zenActive, stripeActive, cryptomusActive, ossActive, zenCount, stripeCount, cryptomusCount, ossCount] =
    await Promise.all([
    db.zenAccount.findFirst({ where: { isActive: true }, select: { id: true, label: true } }),
    db.stripeAccount.findFirst({ where: { isActive: true }, select: { id: true, label: true } }),
    db.cryptomusMerchant.findFirst({ where: { isActive: true }, select: { id: true, label: true } }),
    db.ossAccount.findFirst({ where: { isActive: true }, select: { id: true, label: true, bucket: true } }),
    db.zenAccount.count(),
    db.stripeAccount.count(),
    db.cryptomusMerchant.count(),
    db.ossAccount.count(),
  ]);

  return NextResponse.json({
    app_url: env.APP_URL,
    demo_mode: env.DEMO_MODE,
    vip_price_cents: env.VIP_PRICE,
    credit_packages: env.CREDIT_PACKAGES,
    zen: {
      base_url: env.ZEN_BASE_URL,
      env_key_configured: Boolean(env.ZEN_API_KEY),
      credit_ratio: env.ZEN_CREDIT_RATIO,
      monthly_budget: env.ZEN_MONTHLY_BUDGET,
      db_accounts: zenCount,
      active_account: zenActive ? { id: zenActive.id, label: zenActive.label } : null,
    },
    stripe: {
      env_configured: await stripeConfigured(),
      db_accounts: stripeCount,
      active_account: stripeActive ? { id: stripeActive.id, label: stripeActive.label } : null,
      env_webhook_configured: Boolean(env.STRIPE_WEBHOOK_SECRET),
    },
    cryptomus: {
      env_configured: await cryptomusConfigured(),
      db_merchants: cryptomusCount,
      active_merchant: cryptomusActive ? { id: cryptomusActive.id, label: cryptomusActive.label } : null,
    },
    oss: {
      env_configured: await ossConfigured(),
      db_accounts: ossCount,
      active_account: ossActive
        ? { id: ossActive.id, label: ossActive.label, bucket: ossActive.bucket }
        : null,
      mirror_zen_results: env.OSS_MIRROR_ZEN_RESULTS,
    },
    telegram_configured: telegramConfigured(),
    webhooks: {
      stripe: `${env.APP_URL}/api/payments/webhook`,
      cryptomus: `${env.APP_URL}/api/payments/crypto/webhook`,
      zen: `${env.APP_URL}/api/zen/webhook`,
    },
  });
}
