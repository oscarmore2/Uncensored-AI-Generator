import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { encryptSecret, decryptSecret, maskSecret } from "@/lib/secret-crypto";

function accountOut(a: {
  id: number;
  label: string;
  publishableKey: string | null;
  secretKeyEnc: string;
  webhookSecretEnc: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  let secretMask = "****";
  let webhookMask = "****";
  try {
    secretMask = maskSecret(decryptSecret(a.secretKeyEnc));
  } catch {
    secretMask = "(解密失败)";
  }
  try {
    webhookMask = maskSecret(decryptSecret(a.webhookSecretEnc));
  } catch {
    webhookMask = "(解密失败)";
  }
  return {
    id: a.id,
    label: a.label,
    publishable_key: a.publishableKey,
    secret_key_mask: secretMask,
    webhook_secret_mask: webhookMask,
    is_active: a.isActive,
    created_at: a.createdAt,
    updated_at: a.updatedAt,
  };
}

const patchSchema = z
  .object({
    label: z.string().min(1).max(80).optional(),
    secret_key: z.string().min(10).max(300).optional(),
    webhook_secret: z.string().min(10).max(300).optional(),
    publishable_key: z.string().max(300).nullable().optional(),
    activate: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "至少提供一个字段");

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const accountId = Number(id);
  if (!Number.isInteger(accountId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, { status: 400 });
  }
  const data = parsed.data;

  if (data.secret_key && !data.secret_key.startsWith("sk_")) {
    return NextResponse.json({ error: "Secret Key 应以 sk_ 开头" }, { status: 400 });
  }
  if (data.webhook_secret && !data.webhook_secret.startsWith("whsec_")) {
    return NextResponse.json({ error: "Webhook Secret 应以 whsec_ 开头" }, { status: 400 });
  }
  if (data.publishable_key && data.publishable_key.length > 0 && !data.publishable_key.startsWith("pk_")) {
    return NextResponse.json({ error: "Publishable Key 应以 pk_ 开头" }, { status: 400 });
  }

  const existing = await db.stripeAccount.findUnique({ where: { id: accountId } });
  if (!existing) return NextResponse.json({ error: "账户不存在" }, { status: 404 });

  const account = await db.$transaction(async (tx) => {
    if (data.activate === true) {
      await tx.stripeAccount.updateMany({ where: { isActive: true }, data: { isActive: false } });
    }
    return tx.stripeAccount.update({
      where: { id: accountId },
      data: {
        ...(data.label !== undefined ? { label: data.label } : {}),
        ...(data.secret_key !== undefined ? { secretKeyEnc: encryptSecret(data.secret_key) } : {}),
        ...(data.webhook_secret !== undefined
          ? { webhookSecretEnc: encryptSecret(data.webhook_secret) }
          : {}),
        ...(data.publishable_key !== undefined
          ? { publishableKey: data.publishable_key?.trim() || null }
          : {}),
        ...(data.activate === true ? { isActive: true } : {}),
        ...(data.activate === false ? { isActive: false } : {}),
      },
    });
  });

  return NextResponse.json({ ok: true, account: accountOut(account) });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const accountId = Number(id);
  if (!Number.isInteger(accountId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const existing = await db.stripeAccount.findUnique({ where: { id: accountId } });
  if (!existing) return NextResponse.json({ error: "账户不存在" }, { status: 404 });

  await db.stripeAccount.delete({ where: { id: accountId } });
  return NextResponse.json({ ok: true });
}
