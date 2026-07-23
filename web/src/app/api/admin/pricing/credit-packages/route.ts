import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAdminAction } from "@/lib/admin-audit";
import { ensurePricingSeeded, packageOut } from "@/lib/pricing";

export async function GET() {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  await ensurePricingSeeded();
  const packages = await db.creditPackage.findMany({
    orderBy: [{ sortOrder: "asc" }, { credits: "asc" }],
  });
  return NextResponse.json({ packages: packages.map(packageOut) });
}

const createSchema = z.object({
  credits: z.number().int().positive().max(1_000_000),
  price_cents: z.number().int().positive().max(10_000_000),
  label: z.string().min(1).max(80),
  badge: z.string().max(40).nullable().optional(),
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
  const pkg = await db.creditPackage.create({
    data: {
      credits: d.credits,
      priceCents: d.price_cents,
      label: d.label,
      badge: d.badge ?? null,
      isActive: d.is_active,
      sortOrder: d.sort_order,
    },
  });
  await logAdminAction(admin.id, "pricing_credit_package", { type: "CreditPackage", id: pkg.id }, {
    action: "create",
  });
  return NextResponse.json({ ok: true, package: packageOut(pkg) }, { status: 201 });
}
