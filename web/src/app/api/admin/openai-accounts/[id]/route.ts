import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { encryptSecret } from "@/lib/secret-crypto";
import { logAdminAction } from "@/lib/admin-audit";

const patchSchema = z
  .object({
    label: z.string().min(1).max(80).optional(),
    api_key: z.string().min(10).max(500).optional(),
    base_url: z.string().url().max(300).nullable().optional(),
    moderation_model: z.string().min(1).max(200).nullable().optional(),
    activate: z.boolean().optional(),
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

  const existing = await db.openAiAccount.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "账户不存在" }, { status: 404 });

  const account = await db.$transaction(async (tx) => {
    // 同一时间只允许一个激活账户
    if (d.activate === true) {
      await tx.openAiAccount.updateMany({ where: { isActive: true }, data: { isActive: false } });
    }
    return tx.openAiAccount.update({
      where: { id },
      data: {
        ...(d.label !== undefined ? { label: d.label } : {}),
        ...(d.api_key !== undefined ? { apiKeyEnc: encryptSecret(d.api_key) } : {}),
        ...(d.base_url !== undefined ? { baseUrl: d.base_url?.trim() || null } : {}),
        ...(d.moderation_model !== undefined
          ? { moderationModel: d.moderation_model?.trim() || null }
          : {}),
        ...(d.activate !== undefined ? { isActive: d.activate } : {}),
      },
    });
  });

  await logAdminAction(admin.id, "openai_account", { type: "OpenAiAccount", id }, {
    action: "patch",
    label: account.label,
    activate: d.activate,
    key_rotated: d.api_key !== undefined,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const existing = await db.openAiAccount.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "账户不存在" }, { status: 404 });

  await db.openAiAccount.delete({ where: { id } });
  await logAdminAction(admin.id, "openai_account", { type: "OpenAiAccount", id }, {
    action: "delete",
    label: existing.label,
  });
  return NextResponse.json({ ok: true });
}
