import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAdminAction } from "@/lib/admin-audit";
import { productOut } from "@/lib/pricing";

const patchSchema = z
  .object({
    label: z.string().min(1).max(120).optional(),
    zen_tool: z.string().min(1).max(80).optional(),
    zen_model: z.string().min(1).max(80).optional(),
    variant_key: z.string().max(40).optional(),
    credit_cost: z.number().int().positive().max(100000).optional(),
    batch_four_multiplier: z.number().positive().max(10).optional(),
    is_active: z.boolean().optional(),
    is_default: z.boolean().optional(),
    sort_order: z.number().int().min(-9999).max(9999).optional(),
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

  const existing = await db.generationProduct.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "产品不存在" }, { status: 404 });

  const product = await db.$transaction(async (tx) => {
    if (d.is_default === true) {
      await tx.generationProduct.updateMany({
        where: { mode: existing.mode, isDefault: true, NOT: { id } },
        data: { isDefault: false },
      });
    }
    return tx.generationProduct.update({
      where: { id },
      data: {
        ...(d.label !== undefined ? { label: d.label } : {}),
        ...(d.zen_tool !== undefined ? { zenTool: d.zen_tool } : {}),
        ...(d.zen_model !== undefined ? { zenModel: d.zen_model } : {}),
        ...(d.variant_key !== undefined ? { variantKey: d.variant_key } : {}),
        ...(d.credit_cost !== undefined ? { creditCost: d.credit_cost } : {}),
        ...(d.batch_four_multiplier !== undefined
          ? { batchFourMultiplier: d.batch_four_multiplier }
          : {}),
        ...(d.is_active !== undefined ? { isActive: d.is_active } : {}),
        ...(d.is_default !== undefined ? { isDefault: d.is_default } : {}),
        ...(d.sort_order !== undefined ? { sortOrder: d.sort_order } : {}),
      },
    });
  });

  await logAdminAction(admin.id, "pricing_product", { type: "GenerationProduct", id }, {
    action: "patch",
    ...d,
  });

  return NextResponse.json({ ok: true, product: productOut(product) });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const existing = await db.generationProduct.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "产品不存在" }, { status: 404 });

  await db.generationProduct.delete({ where: { id } });
  await logAdminAction(admin.id, "pricing_product", { type: "GenerationProduct", id }, {
    action: "delete",
    label: existing.label,
  });
  return NextResponse.json({ ok: true });
}
