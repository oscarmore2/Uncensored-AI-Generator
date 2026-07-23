import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAdminAction } from "@/lib/admin-audit";
import { ensurePricingSeeded, planOut, tierOut } from "@/lib/pricing";

export async function GET() {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  await ensurePricingSeeded();
  const plans = await db.vipPlan.findMany({
    include: { tier: true },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  return NextResponse.json({
    plans: plans.map((p) => ({ ...planOut(p), tier: tierOut(p.tier) })),
  });
}

const createSchema = z.object({
  tier_id: z.number().int().positive(),
  label: z.string().min(1).max(80),
  price_cents: z.number().int().positive().max(10_000_000),
  bonus_credits: z.number().int().min(0).max(1_000_000).optional().default(0),
  duration_days: z.number().int().positive().max(3650).optional().default(30),
  is_active: z.boolean().optional().default(true),
  sort_order: z.number().int().optional().default(0),
});

export async function POST(req: Request) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  await ensurePricingSeeded();
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, { status: 400 });
  }
  const d = parsed.data;
  const tier = await db.vipTier.findUnique({ where: { id: d.tier_id } });
  if (!tier) return NextResponse.json({ error: "VIP 等级不存在" }, { status: 400 });

  const plan = await db.vipPlan.create({
    data: {
      tierId: d.tier_id,
      label: d.label,
      priceCents: d.price_cents,
      bonusCredits: d.bonus_credits,
      durationDays: d.duration_days,
      isActive: d.is_active,
      sortOrder: d.sort_order,
    },
    include: { tier: true },
  });
  await logAdminAction(admin.id, "pricing_vip_plan", { type: "VipPlan", id: plan.id }, {
    action: "create",
  });
  return NextResponse.json(
    { ok: true, plan: { ...planOut(plan), tier: tierOut(plan.tier) } },
    { status: 201 }
  );
}
