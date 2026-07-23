import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAdminAction } from "@/lib/admin-audit";
import { tierOut } from "@/lib/pricing";

const patchSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    rank: z.number().int().min(0).max(1000).optional(),
    discount_percent: z.number().min(0).max(100).optional(),
    discount_bps: z.number().int().min(0).max(10000).optional(),
    plaything_access: z.boolean().optional(),
    is_active: z.boolean().optional(),
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
  const existing = await db.vipTier.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "等级不存在" }, { status: 404 });

  const discountBps =
    d.discount_bps !== undefined
      ? d.discount_bps
      : d.discount_percent !== undefined
        ? Math.round(d.discount_percent * 100)
        : undefined;

  const tier = await db.vipTier.update({
    where: { id },
    data: {
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.rank !== undefined ? { rank: d.rank } : {}),
      ...(discountBps !== undefined ? { discountBps } : {}),
      ...(d.plaything_access !== undefined ? { playthingAccess: d.plaything_access } : {}),
      ...(d.is_active !== undefined ? { isActive: d.is_active } : {}),
    },
  });
  await logAdminAction(admin.id, "pricing_vip_tier", { type: "VipTier", id }, { action: "patch" });
  return NextResponse.json({ ok: true, tier: tierOut(tier) });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const existing = await db.vipTier.findUnique({
    where: { id },
    include: { _count: { select: { plans: true, users: true } } },
  });
  if (!existing) return NextResponse.json({ error: "等级不存在" }, { status: 404 });
  if (existing._count.plans > 0 || existing._count.users > 0) {
    return NextResponse.json(
      { error: "该等级仍有套餐或用户绑定，请先停用或迁移后再删除" },
      { status: 400 }
    );
  }
  await db.vipTier.delete({ where: { id } });
  await logAdminAction(admin.id, "pricing_vip_tier", { type: "VipTier", id }, { action: "delete" });
  return NextResponse.json({ ok: true });
}
