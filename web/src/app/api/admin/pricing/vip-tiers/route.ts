import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAdminAction } from "@/lib/admin-audit";
import { ensurePricingSeeded, tierOut } from "@/lib/pricing";

export async function GET() {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  await ensurePricingSeeded();
  const tiers = await db.vipTier.findMany({ orderBy: [{ rank: "asc" }, { id: "asc" }] });
  return NextResponse.json({ tiers: tiers.map(tierOut) });
}

const createSchema = z.object({
  code: z.string().min(1).max(40).regex(/^[a-z0-9_]+$/),
  name: z.string().min(1).max(80),
  rank: z.number().int().min(0).max(1000).optional().default(0),
  discount_percent: z.number().min(0).max(100).optional(),
  discount_bps: z.number().int().min(0).max(10000).optional(),
  plaything_access: z.boolean().optional().default(false),
  is_active: z.boolean().optional().default(true),
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
  const discountBps =
    d.discount_bps !== undefined
      ? d.discount_bps
      : d.discount_percent !== undefined
        ? Math.round(d.discount_percent * 100)
        : 0;
  const tier = await db.vipTier.create({
    data: {
      code: d.code,
      name: d.name,
      rank: d.rank,
      discountBps,
      playthingAccess: d.plaything_access,
      isActive: d.is_active,
    },
  });
  await logAdminAction(admin.id, "pricing_vip_tier", { type: "VipTier", id: tier.id }, {
    action: "create",
  });
  return NextResponse.json({ ok: true, tier: tierOut(tier) }, { status: 201 });
}
