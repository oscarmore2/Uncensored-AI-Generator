import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { requireRole } from "@/lib/auth";
import { telegramConfigured } from "@/lib/telegram";
import { cryptomusConfigured } from "@/lib/cryptomus";
import { stripeConfigured } from "@/lib/stripe";
import { ossConfigured } from "@/lib/oss";
import { hfConfigured } from "@/lib/hf";
import { ensurePricingSeeded } from "@/lib/pricing-seed";

/** 只读配置快照（脱敏，不返回 secret 明文） */
export async function GET() {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await ensurePricingSeeded();

  const [
    zenActive,
    stripeActive,
    cryptomusActive,
    ossActive,
    hfActive,
    zenCount,
    stripeCount,
    cryptomusCount,
    ossCount,
    hfCount,
    productCount,
    packageCount,
    tierCount,
    planCount,
  ] = await Promise.all([
    db.zenAccount.findFirst({ where: { isActive: true }, select: { id: true, label: true } }),
    db.stripeAccount.findFirst({ where: { isActive: true }, select: { id: true, label: true } }),
    db.cryptomusMerchant.findFirst({ where: { isActive: true }, select: { id: true, label: true } }),
    db.ossAccount.findFirst({
      where: { isActive: true },
      select: { id: true, label: true, bucket: true },
    }),
    db.hfAccount.findFirst({ where: { isActive: true }, select: { id: true, label: true } }),
    db.zenAccount.count(),
    db.stripeAccount.count(),
    db.cryptomusMerchant.count(),
    db.ossAccount.count(),
    db.hfAccount.count(),
    db.generationProduct.count({ where: { isActive: true } }),
    db.creditPackage.count({ where: { isActive: true } }),
    db.vipTier.count({ where: { isActive: true } }),
    db.vipPlan.count({ where: { isActive: true } }),
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
      active_merchant: cryptomusActive
        ? { id: cryptomusActive.id, label: cryptomusActive.label }
        : null,
    },
    oss: {
      env_configured: await ossConfigured(),
      db_accounts: ossCount,
      active_account: ossActive
        ? { id: ossActive.id, label: ossActive.label, bucket: ossActive.bucket }
        : null,
      mirror_zen_results: env.OSS_MIRROR_ZEN_RESULTS,
    },
    hf: {
      configured: await hfConfigured(),
      env_token_configured: Boolean(env.HF_TOKEN),
      inference_base_url: env.HF_INFERENCE_BASE_URL,
      magic_model: env.HF_MAGIC_MODEL,
      db_accounts: hfCount,
      active_account: hfActive ? { id: hfActive.id, label: hfActive.label } : null,
    },
    pricing: {
      db_enabled: true,
      active_products: productCount,
      active_credit_packages: packageCount,
      active_vip_tiers: tierCount,
      active_vip_plans: planCount,
    },
    telegram_configured: telegramConfigured(),
    webhooks: {
      stripe: `${env.APP_URL}/api/payments/webhook`,
      cryptomus: `${env.APP_URL}/api/payments/crypto/webhook`,
      zen: `${env.APP_URL}/api/zen/webhook`,
    },
  });
}
