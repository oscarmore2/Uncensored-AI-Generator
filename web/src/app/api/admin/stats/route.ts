import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { requireRole } from "@/lib/auth";
import { telegramConfigured, sendTelegramAlertOnce } from "@/lib/telegram";

export const dynamic = "force-dynamic";

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

const GEN_STATUSES = ["pending", "queued", "processing", "succeeded", "partial", "failed"] as const;

/** 管理端总览：总量卡片 + 近 30 天逐日序列 + Zen 消耗估算 */
export async function GET() {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const now = new Date();
  const todayStart = startOfDay(now);
  const days30Ago = startOfDay(new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000));
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    totalUsers,
    todayUsers,
    disabledUsers,
    revenueAgg,
    consumeAgg,
    totalGenerations,
    failedGenerations,
    publicWorks,
    monthCostAgg,
    recentUsers,
    recentTx,
    recentGens,
    revenueByMethod,
    genStatusCounts,
    uncreditedCryptoCount,
    featuredGenIds,
    cryptoByMerchant,
    stripeByAccount,
    cryptomusMerchants,
    stripeAccounts,
  ] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { createdAt: { gte: todayStart } } }),
    db.user.count({ where: { disabledAt: { not: null } } }),
    db.transaction.aggregate({ where: { type: "recharge" }, _sum: { priceCents: true } }),
    db.generation.aggregate({ where: { status: { not: "failed" } }, _sum: { cost: true } }),
    db.generation.count(),
    db.generation.count({ where: { status: "failed" } }),
    db.publicWork.count({ where: { isPublished: true } }),
    db.generation.aggregate({
      where: { status: "succeeded", createdAt: { gte: monthStart } },
      _sum: { cost: true },
    }),
    db.user.findMany({
      where: { createdAt: { gte: days30Ago } },
      select: { createdAt: true },
    }),
    db.transaction.findMany({
      where: { type: "recharge", createdAt: { gte: days30Ago } },
      select: { createdAt: true, priceCents: true, method: true },
    }),
    db.generation.findMany({
      where: { createdAt: { gte: days30Ago } },
      select: { createdAt: true },
    }),
    db.transaction.groupBy({
      by: ["method"],
      where: { type: "recharge" },
      _sum: { priceCents: true },
      _count: { id: true },
    }),
    db.generation.groupBy({
      by: ["status"],
      _count: { id: true },
    }),
    db.cryptoPayment.count({ where: { credited: false } }),
    db.publicWork.findMany({
      where: { sourceGenerationId: { not: null } },
      select: { sourceGenerationId: true },
    }),
    db.cryptoPayment.groupBy({
      by: ["merchantRefId"],
      where: { credited: true },
      _sum: { amountUsdCents: true },
      _count: { id: true },
    }),
    db.transaction.groupBy({
      by: ["stripeAccountRefId"],
      where: { type: "recharge", method: "stripe" },
      _sum: { priceCents: true },
      _count: { id: true },
    }),
    db.cryptomusMerchant.findMany({ select: { id: true, label: true } }),
    db.stripeAccount.findMany({ select: { id: true, label: true } }),
  ]);

  const featuredSet = new Set(
    featuredGenIds.map((w) => w.sourceGenerationId).filter((id): id is number => id !== null)
  );
  const pendingReview = await db.generation.count({
    where: {
      status: "succeeded",
      deletedAt: null,
      id: { notIn: [...featuredSet] },
    },
  });

  const generationsByStatus = Object.fromEntries(GEN_STATUSES.map((s) => [s, 0])) as Record<
    (typeof GEN_STATUSES)[number],
    number
  >;
  for (const row of genStatusCounts) {
    if (row.status in generationsByStatus) {
      generationsByStatus[row.status as (typeof GEN_STATUSES)[number]] = row._count.id;
    }
  }

  const revenue_by_method: Record<string, { cents: number; count: number }> = {};
  for (const row of revenueByMethod) {
    const key = row.method ?? "unknown";
    revenue_by_method[key] = {
      cents: row._sum.priceCents ?? 0,
      count: row._count.id,
    };
  }

  const merchantLabel = new Map(cryptomusMerchants.map((m) => [m.id, m.label]));
  const stripeLabel = new Map(stripeAccounts.map((a) => [a.id, a.label]));

  const revenue_by_cryptomus_merchant = cryptoByMerchant.map((row) => ({
    merchant_id: row.merchantRefId,
    label: row.merchantRefId ? (merchantLabel.get(row.merchantRefId) ?? `#${row.merchantRefId}`) : "env/未知",
    cents: row._sum.amountUsdCents ?? 0,
    count: row._count.id,
  }));

  const revenue_by_stripe_account = stripeByAccount.map((row) => ({
    account_id: row.stripeAccountRefId,
    label: row.stripeAccountRefId ? (stripeLabel.get(row.stripeAccountRefId) ?? `#${row.stripeAccountRefId}`) : "env/未知",
    cents: row._sum.priceCents ?? 0,
    count: row._count.id,
  }));

  const series: {
    date: string;
    registrations: number;
    revenue_cents: number;
    generations: number;
    revenue_stripe: number;
    revenue_cryptomus: number;
    revenue_demo: number;
  }[] = [];
  const indexByDate = new Map<string, number>();
  for (let i = 0; i < 30; i++) {
    const d = new Date(days30Ago.getTime() + i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    indexByDate.set(key, series.length);
    series.push({
      date: key,
      registrations: 0,
      revenue_cents: 0,
      generations: 0,
      revenue_stripe: 0,
      revenue_cryptomus: 0,
      revenue_demo: 0,
    });
  }
  const bucket = (d: Date) => indexByDate.get(startOfDay(d).toISOString().slice(0, 10));
  for (const u of recentUsers) {
    const i = bucket(u.createdAt);
    if (i !== undefined) series[i].registrations++;
  }
  for (const t of recentTx) {
    const i = bucket(t.createdAt);
    if (i !== undefined) {
      const cents = t.priceCents ?? 0;
      series[i].revenue_cents += cents;
      if (t.method === "stripe") series[i].revenue_stripe += cents;
      else if (t.method === "cryptomus") series[i].revenue_cryptomus += cents;
      else if (t.method === "demo") series[i].revenue_demo += cents;
    }
  }
  for (const g of recentGens) {
    const i = bucket(g.createdAt);
    if (i !== undefined) series[i].generations++;
  }

  const monthCredits = monthCostAgg._sum.cost ?? 0;
  const zenEstimated = Math.round(monthCredits * env.ZEN_CREDIT_RATIO);
  const zenBudget = env.ZEN_MONTHLY_BUDGET;
  const zenUsageRatio = zenBudget > 0 ? zenEstimated / zenBudget : null;
  if (zenBudget > 0 && zenUsageRatio !== null && zenUsageRatio >= 0.8) {
    sendTelegramAlertOnce(
      `zen-budget-${now.getFullYear()}-${now.getMonth() + 1}`,
      `📉 Zen 预算告警：本月估算已消耗 ${zenEstimated}/${zenBudget} credits（${Math.round(zenUsageRatio * 100)}%）`
    );
  }

  return NextResponse.json({
    totals: {
      users: totalUsers,
      users_today: todayUsers,
      users_disabled: disabledUsers,
      revenue_cents: revenueAgg._sum.priceCents ?? 0,
      credits_consumed: consumeAgg._sum.cost ?? 0,
      generations: totalGenerations,
      generations_failed: failedGenerations,
      failure_rate: totalGenerations > 0 ? failedGenerations / totalGenerations : 0,
      public_works: publicWorks,
      uncredited_crypto_count: uncreditedCryptoCount,
    },
    revenue_by_method,
    generations_by_status: generationsByStatus,
    mod_queue: { pending_review: pendingReview },
    revenue_by_cryptomus_merchant,
    revenue_by_stripe_account,
    series,
    zen: {
      month_credits: monthCredits,
      estimated_zen_credits: zenEstimated,
      ratio: env.ZEN_CREDIT_RATIO,
      monthly_budget: zenBudget,
      usage_ratio: zenUsageRatio,
    },
    telegram_configured: telegramConfigured(),
  });
}
