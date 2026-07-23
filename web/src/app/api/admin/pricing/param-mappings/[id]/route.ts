import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAdminAction } from "@/lib/admin-audit";
import { mappingOut } from "@/lib/pricing";

const patchSchema = z
  .object({
    ui_key: z.string().min(1).max(40).optional(),
    zen_path: z.string().min(1).max(80).optional(),
    value_map: z.record(z.string(), z.unknown()).nullable().optional(),
    options: z
      .array(z.object({ value: z.string(), label: z.string() }))
      .nullable()
      .optional(),
    enabled: z.boolean().optional(),
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
  const existing = await db.modeParamMapping.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "映射不存在" }, { status: 404 });

  const row = await db.modeParamMapping.update({
    where: { id },
    data: {
      ...(d.ui_key !== undefined ? { uiKey: d.ui_key } : {}),
      ...(d.zen_path !== undefined ? { zenPath: d.zen_path } : {}),
      ...(d.value_map !== undefined
        ? { valueMap: d.value_map ? JSON.stringify(d.value_map) : null }
        : {}),
      ...(d.options !== undefined
        ? { options: d.options ? JSON.stringify(d.options) : null }
        : {}),
      ...(d.enabled !== undefined ? { enabled: d.enabled } : {}),
      ...(d.sort_order !== undefined ? { sortOrder: d.sort_order } : {}),
    },
  });

  await logAdminAction(admin.id, "pricing_param_mapping", { type: "ModeParamMapping", id }, {
    action: "patch",
  });
  return NextResponse.json({ ok: true, mapping: mappingOut(row) });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const existing = await db.modeParamMapping.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "映射不存在" }, { status: 404 });
  await db.modeParamMapping.delete({ where: { id } });
  await logAdminAction(admin.id, "pricing_param_mapping", { type: "ModeParamMapping", id }, {
    action: "delete",
  });
  return NextResponse.json({ ok: true });
}
