import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAdminAction } from "@/lib/admin-audit";
import { planOut, tierOut } from "@/lib/pricing";

const patchSchema = z
  .object({
    tier_id: z.number().int().positive().optional(),
    label: z.string().min(1).max(80).optional(),
    price_cents: z.number().int().positive().max(10_000_000).optional(),
    bonus_credits: z.number().int().min(0).max(1_000_000).optional(),
    duration_days: z.number().int().positive().max(3650).optional(),
    is_active: z.boolean().optional(),
    sort_order: z.number().int().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "至少提供一个字段");

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, { status: 400 });
  }
  const d = parsed.data;
  const existing = await db.vipPlan.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "套餐不存在" }, { status: 404 });
  if (d.tier_id) {
    const tier = await db.vipTier.findUnique({ where: { id: d.tier_id } });
    if (!tier) return NextResponse.json({ error: "VIP 等级不存在" }, { status: 400 });
  }

  const plan = await db.vipPlan.update({
    where: { id },
    data: {
      ...(d.tier_id !== undefined ? { tierId: d.tier_id } : {}),
      ...(d.label !== undefined ? { label: d.label } : {}),
      ...(d.price_cents !== undefined ? { priceCents: d.price_cents } : {}),
      ...(d.bonus_credits !== undefined ? { bonusCredits: d.bonus_credits } : {}),
      ...(d.duration_days !== undefined ? { durationDays: d.duration_days } : {}),
      ...(d.is_active !== undefined ? { isActive: d.is_active } : {}),
      ...(d.sort_order !== undefined ? { sortOrder: d.sort_order } : {}),
    },
    include: { tier: true },
  });
  await logAdminAction(admin.id, "pricing_vip_plan", { type: "VipPlan", id }, { action: "patch" });
  return NextResponse.json({ ok: true, plan: { ...planOut(plan), tier: tierOut(plan.tier) } });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const existing = await db.vipPlan.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "套餐不存在" }, { status: 404 });
  await db.vipPlan.delete({ where: { id } });
  await logAdminAction(admin.id, "pricing_vip_plan", { type: "VipPlan", id }, { action: "delete" });
  return NextResponse.json({ ok: true });
}
