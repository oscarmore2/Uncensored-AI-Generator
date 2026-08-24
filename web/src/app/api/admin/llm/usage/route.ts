import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { USD_PER_CREDIT } from "@/lib/llm/billing";
import { formatMicroCredits, microToUsd, MICRO_PER_CREDIT } from "@/lib/llm/pricing";

/**
 * 成本报表。这张页面存在的唯一理由：**知道 AI 功能到底在亏还是在赚**。
 *
 * 毛利按美元口径算，不按点数——点数只是我们自己的记账单位，
 * 上游收的是美元。两边混着算会得出一个看着很美但没有意义的数。
 */
export async function GET(req: Request) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const days = clampDays(new URL(req.url).searchParams.get("days"));
  const since = new Date(Date.now() - days * 24 * 3600_000);

  const [byModel, byStatus, estimated, total, recent] = await Promise.all([
    db.llmUsageLog.groupBy({
      by: ["modelKey"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _sum: {
        promptTokens: true,
        completionTokens: true,
        costUsdMicro: true,
        chargedMicro: true,
        settledCredits: true,
      },
    }),
    db.llmUsageLog.groupBy({
      by: ["status"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { chargedMicro: true, costUsdMicro: true },
    }),
    db.llmUsageLog.count({ where: { createdAt: { gte: since }, costEstimated: true } }),
    db.llmUsageLog.aggregate({
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { costUsdMicro: true, chargedMicro: true, settledCredits: true },
    }),
    db.llmUsageLog.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);

  const costUsd = microToUsd(total._sum.costUsdMicro ?? 0);
  const chargedUsd = ((total._sum.chargedMicro ?? 0) / MICRO_PER_CREDIT) * USD_PER_CREDIT;

  return NextResponse.json({
    days,
    summary: {
      calls: total._count._all,
      cost_usd: round6(costUsd),
      charged_usd: round6(chargedUsd),
      charged_credits: formatMicroCredits(total._sum.chargedMicro ?? 0),
      settled_credits: total._sum.settledCredits ?? 0,
      /** 毛利率。上游涨价时它会先掉下来，比看单价表更早示警 */
      margin_bps: chargedUsd > 0 ? Math.round(((chargedUsd - costUsd) / chargedUsd) * 10000) : null,
      /*
       * 估算占比。持续偏高说明上游根本没回成本，那时报表里的「毛利」
       * 其实是拿我们自己的单价表在自证，得去查 8.1 那三件事。
       */
      estimated_ratio_bps:
        total._count._all > 0 ? Math.round((estimated / total._count._all) * 10000) : 0,
    },
    by_model: byModel.map((m) => {
      const c = microToUsd(m._sum.costUsdMicro ?? 0);
      const ch = ((m._sum.chargedMicro ?? 0) / MICRO_PER_CREDIT) * USD_PER_CREDIT;
      return {
        model_key: m.modelKey,
        calls: m._count._all,
        prompt_tokens: m._sum.promptTokens ?? 0,
        completion_tokens: m._sum.completionTokens ?? 0,
        cost_usd: round6(c),
        charged_usd: round6(ch),
        charged_credits: formatMicroCredits(m._sum.chargedMicro ?? 0),
        settled_credits: m._sum.settledCredits ?? 0,
        margin_bps: ch > 0 ? Math.round(((ch - c) / ch) * 10000) : null,
      };
    }),
    by_status: byStatus.map((s) => ({
      status: s.status,
      calls: s._count._all,
      charged_credits: formatMicroCredits(s._sum.chargedMicro ?? 0),
      cost_usd: round6(microToUsd(s._sum.costUsdMicro ?? 0)),
    })),
    recent: recent.map((r) => ({
      id: r.id,
      user_id: r.userId,
      skill_key: r.skillKey,
      model_key: r.modelKey,
      trigger: r.trigger,
      prompt_tokens: r.promptTokens,
      completion_tokens: r.completionTokens,
      cost_usd: round6(microToUsd(r.costUsdMicro)),
      cost_estimated: r.costEstimated,
      charged_credits: formatMicroCredits(r.chargedMicro),
      settled_credits: r.settledCredits,
      status: r.status,
      created_at: r.createdAt,
    })),
  });
}

function clampDays(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 30;
  return Math.min(180, Math.max(1, Math.round(n)));
}

function round6(v: number): number {
  return Number(v.toFixed(6));
}
