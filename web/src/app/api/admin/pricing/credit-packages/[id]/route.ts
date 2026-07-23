import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAdminAction } from "@/lib/admin-audit";
import { packageOut } from "@/lib/pricing";

const patchSchema = z
  .object({
    credits: z.number().int().positive().max(1_000_000).optional(),
    price_cents: z.number().int().positive().max(10_000_000).optional(),
    label: z.string().min(1).max(80).optional(),
    badge: z.string().max(40).nullable().optional(),
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
  const existing = await db.creditPackage.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "套餐不存在" }, { status: 404 });
  const pkg = await db.creditPackage.update({
    where: { id },
    data: {
      ...(d.credits !== undefined ? { credits: d.credits } : {}),
      ...(d.price_cents !== undefined ? { priceCents: d.price_cents } : {}),
      ...(d.label !== undefined ? { label: d.label } : {}),
      ...(d.badge !== undefined ? { badge: d.badge } : {}),
      ...(d.is_active !== undefined ? { isActive: d.is_active } : {}),
      ...(d.sort_order !== undefined ? { sortOrder: d.sort_order } : {}),
    },
  });
  await logAdminAction(admin.id, "pricing_credit_package", { type: "CreditPackage", id }, {
    action: "patch",
  });
  return NextResponse.json({ ok: true, package: packageOut(pkg) });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const existing = await db.creditPackage.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "套餐不存在" }, { status: 404 });
  await db.creditPackage.delete({ where: { id } });
  await logAdminAction(admin.id, "pricing_credit_package", { type: "CreditPackage", id }, {
    action: "delete",
  });
  return NextResponse.json({ ok: true });
}
