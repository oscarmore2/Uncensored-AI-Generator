import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAdminAction } from "@/lib/admin-audit";
import { ensurePricingSeeded, productOut } from "@/lib/pricing";

export async function GET() {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  await ensurePricingSeeded();
  const products = await db.generationProduct.findMany({
    orderBy: [{ mode: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
  });
  return NextResponse.json({ products: products.map(productOut) });
}

const createSchema = z.object({
  mode: z.enum(["txt2img", "txt2vid", "img2img", "img2vid", "undress"]),
  zen_tool: z.string().min(1).max(80),
  zen_model: z.string().min(1).max(80),
  variant_key: z.string().max(40).optional().default(""),
  label: z.string().min(1).max(120),
  credit_cost: z.number().int().positive().max(100000),
  batch_four_multiplier: z.number().positive().max(10).optional().default(1.5),
  is_active: z.boolean().optional().default(true),
  is_default: z.boolean().optional().default(false),
  sort_order: z.number().int().min(-9999).max(9999).optional().default(0),
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
  const variantKey = d.mode === "undress" ? d.variant_key || "female" : d.variant_key || "";

  const product = await db.$transaction(async (tx) => {
    if (d.is_default) {
      await tx.generationProduct.updateMany({
        where: { mode: d.mode, isDefault: true },
        data: { isDefault: false },
      });
    }
    return tx.generationProduct.create({
      data: {
        mode: d.mode,
        zenTool: d.zen_tool,
        zenModel: d.zen_model,
        variantKey,
        label: d.label,
        creditCost: d.credit_cost,
        batchFourMultiplier: d.mode === "undress" ? 1 : d.batch_four_multiplier,
        isActive: d.is_active,
        isDefault: d.is_default,
        sortOrder: d.sort_order,
      },
    });
  });

  await logAdminAction(admin.id, "pricing_product", { type: "GenerationProduct", id: product.id }, {
    action: "create",
    label: product.label,
  });

  return NextResponse.json({ ok: true, product: productOut(product) }, { status: 201 });
}
