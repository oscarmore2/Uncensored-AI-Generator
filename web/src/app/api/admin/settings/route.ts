import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { requireRole } from "@/lib/auth";
import { telegramConfigured } from "@/lib/telegram";
import { getActiveNowPaymentsCredentials } from "@/lib/nowpayments";
import { stripeConfigured } from "@/lib/stripe";
import { ossConfigured } from "@/lib/oss";
import { hfConfigured } from "@/lib/hf";
import { openAiConfigured } from "@/lib/openai";
import { ensurePricingSeeded } from "@/lib/pricing-seed";
import { z } from "zod";
import { assertSameOrigin } from "@/lib/csrf";
import {
  getSignupInitialCredits,
  MAX_SIGNUP_INITIAL_CREDITS,
  setSignupInitialCredits,
} from "@/lib/signup-settings";
import { logAdminAction } from "@/lib/admin-audit";

/** 只读配置快照（脱敏，不返回 secret 明文） */
export async function GET() {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await ensurePricingSeeded();

  const [
    wsActive,
    stripeActive,
    ossActive,
    hfActive,
    openAiActive,
    wsCount,
    stripeCount,
    ossCount,
    hfCount,
    openAiCount,
    productCount,
    packageCount,
    tierCount,
    planCount,
    signupInitialCredits,
    nowPaymentsCredentials,
    nowPaymentsAccountCount,
  ] = await Promise.all([
    db.waveSpeedAccount.findFirst({ where: { isActive: true }, select: { id: true, label: true } }),
    db.stripeAccount.findFirst({ where: { isActive: true }, select: { id: true, label: true } }),
    db.ossAccount.findFirst({
      where: { isActive: true },
      select: { id: true, label: true, bucket: true },
    }),
    db.hfAccount.findFirst({ where: { isActive: true }, select: { id: true, label: true } }),
    db.openAiAccount.findFirst({ where: { isActive: true }, select: { id: true, label: true } }),
    db.waveSpeedAccount.count(),
    db.stripeAccount.count(),
    db.ossAccount.count(),
    db.hfAccount.count(),
    db.openAiAccount.count(),
    db.generationProduct.count({ where: { isActive: true } }),
    db.creditPackage.count({ where: { isActive: true } }),
    db.vipTier.count({ where: { isActive: true } }),
    db.vipPlan.count({ where: { isActive: true } }),
    getSignupInitialCredits(),
    getActiveNowPaymentsCredentials(),
    db.nowPaymentsAccount.count(),
  ]);

  return NextResponse.json({
    app_url: env.APP_URL,
    demo_mode: env.DEMO_MODE,
    signup_initial_credits: signupInitialCredits,
    vip_price_cents: env.VIP_PRICE,
    credit_packages: env.CREDIT_PACKAGES,
    wavespeed: {
      base_url: env.WAVESPEED_BASE_URL,
      env_key_configured: Boolean(env.WAVESPEED_API_KEY),
      db_accounts: wsCount,
      active_account: wsActive ? { id: wsActive.id, label: wsActive.label } : null,
    },
    stripe: {
      env_configured: await stripeConfigured(),
      db_accounts: stripeCount,
      active_account: stripeActive ? { id: stripeActive.id, label: stripeActive.label } : null,
      env_webhook_configured: Boolean(env.STRIPE_WEBHOOK_SECRET),
    },
    nowpayments: {
      configured: Boolean(
        nowPaymentsCredentials?.apiKey && nowPaymentsCredentials.ipnSecret
      ),
      source: nowPaymentsCredentials?.source ?? null,
      active_label: nowPaymentsCredentials?.label ?? null,
      db_accounts: nowPaymentsAccountCount,
      api_key_configured: Boolean(env.NOWPAYMENTS_API_KEY),
      ipn_secret_configured: Boolean(env.NOWPAYMENTS_IPN_SECRET),
      base_url: env.NOWPAYMENTS_BASE_URL,
    },
    oss: {
      env_configured: await ossConfigured(),
      db_accounts: ossCount,
      active_account: ossActive
        ? { id: ossActive.id, label: ossActive.label, bucket: ossActive.bucket }
        : null,
      mirror_results: env.OSS_MIRROR_RESULTS,
    },
    hf: {
      configured: await hfConfigured(),
      env_token_configured: Boolean(env.HF_TOKEN),
      inference_base_url: env.HF_INFERENCE_BASE_URL,
      magic_model: env.HF_MAGIC_MODEL,
      db_accounts: hfCount,
      active_account: hfActive ? { id: hfActive.id, label: hfActive.label } : null,
    },
    content_safety: {
      configured: await openAiConfigured(),
      env_key_configured: Boolean(env.OPENAI_API_KEY),
      moderation_model: env.OPENAI_MODERATION_MODEL,
      db_accounts: openAiCount,
      active_account: openAiActive ? { id: openAiActive.id, label: openAiActive.label } : null,
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
      nowpayments: `${env.APP_URL}/api/payments/crypto/webhook`,
    },
  });
}

const patchSchema = z.object({
  signup_initial_credits: z
    .number()
    .int()
    .min(0)
    .max(MAX_SIGNUP_INITIAL_CREDITS),
});

export async function PATCH(req: Request) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const originCheck = assertSameOrigin(req);
  if (!originCheck.ok) {
    return NextResponse.json({ error: originCheck.error }, { status: originCheck.status });
  }
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: `注册初始点数须为 0–${MAX_SIGNUP_INITIAL_CREDITS} 的整数` },
      { status: 400 }
    );
  }
  const previous = await getSignupInitialCredits();
  await setSignupInitialCredits(parsed.data.signup_initial_credits);
  await logAdminAction(
    admin.id,
    "system_signup_credits",
    { type: "app_setting", id: "signup_initial_credits" },
    { previous, next: parsed.data.signup_initial_credits }
  );
  return NextResponse.json({
    ok: true,
    signup_initial_credits: parsed.data.signup_initial_credits,
  });
}
