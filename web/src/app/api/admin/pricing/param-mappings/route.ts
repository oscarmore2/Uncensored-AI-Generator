import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAdminAction } from "@/lib/admin-audit";
import { ensurePricingSeeded, mappingOut } from "@/lib/pricing";

export async function GET() {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  await ensurePricingSeeded();
  const rows = await db.modeParamMapping.findMany({
    orderBy: [{ mode: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
  });
  return NextResponse.json({ mappings: rows.map(mappingOut) });
}

const createSchema = z.object({
  mode: z.enum(["txt2img", "txt2vid", "img2img", "img2vid", "undress"]),
  ui_key: z.string().min(1).max(40),
  zen_path: z.string().min(1).max(80),
  value_map: z.record(z.string(), z.unknown()).nullable().optional(),
  options: z
    .array(z.object({ value: z.string(), label: z.string() }))
    .nullable()
    .optional(),
  enabled: z.boolean().optional().default(true),
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
  const row = await db.modeParamMapping.create({
    data: {
      mode: d.mode,
      uiKey: d.ui_key,
      zenPath: d.zen_path,
      valueMap: d.value_map ? JSON.stringify(d.value_map) : null,
      options: d.options ? JSON.stringify(d.options) : null,
      enabled: d.enabled,
      sortOrder: d.sort_order,
    },
  });
  await logAdminAction(admin.id, "pricing_param_mapping", { type: "ModeParamMapping", id: row.id }, {
    action: "create",
  });
  return NextResponse.json({ ok: true, mapping: mappingOut(row) }, { status: 201 });
}
