import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { encryptSecret, decryptSecret, maskSecret } from "@/lib/secret-crypto";
import { testHfToken } from "@/lib/hf";

function accountOut(a: {
  id: number;
  label: string;
  apiTokenEnc: string;
  baseUrl: string | null;
  magicModel: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  let tokenMask = "****";
  try {
    tokenMask = maskSecret(decryptSecret(a.apiTokenEnc));
  } catch {
    tokenMask = "(解密失败)";
  }
  return {
    id: a.id,
    label: a.label,
    api_token_mask: tokenMask,
    base_url: a.baseUrl,
    magic_model: a.magicModel,
    is_active: a.isActive,
    created_at: a.createdAt,
    updated_at: a.updatedAt,
  };
}

const patchSchema = z
  .object({
    label: z.string().min(1).max(80).optional(),
    api_token: z.string().min(10).max(500).optional(),
    base_url: z.string().url().max(300).nullable().optional(),
    magic_model: z.string().min(1).max(200).nullable().optional(),
    activate: z.boolean().optional(),
    verify: z.boolean().optional(),
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

  const existing = await db.hfAccount.findUnique({ where: { id: accountId } });
  if (!existing) return NextResponse.json({ error: "账户不存在" }, { status: 404 });

  if (data.api_token && !data.api_token.startsWith("hf_")) {
    return NextResponse.json({ error: "Token 通常以 hf_ 开头" }, { status: 400 });
  }

  if (data.api_token && data.verify !== false) {
    try {
      await testHfToken(data.api_token, {
        baseUrl: data.base_url ?? existing.baseUrl ?? undefined,
        magicModel: data.magic_model ?? existing.magicModel ?? undefined,
      });
    } catch (err) {
      return NextResponse.json(
        { error: `无法验证 Token: ${err instanceof Error ? err.message : err}` },
        { status: 400 }
      );
    }
  }

  const account = await db.$transaction(async (tx) => {
    if (data.activate === true) {
      await tx.hfAccount.updateMany({ where: { isActive: true }, data: { isActive: false } });
    }
    return tx.hfAccount.update({
      where: { id: accountId },
      data: {
        ...(data.label !== undefined ? { label: data.label } : {}),
        ...(data.api_token !== undefined ? { apiTokenEnc: encryptSecret(data.api_token) } : {}),
        ...(data.base_url !== undefined ? { baseUrl: data.base_url?.trim() || null } : {}),
        ...(data.magic_model !== undefined ? { magicModel: data.magic_model?.trim() || null } : {}),
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

  const existing = await db.hfAccount.findUnique({ where: { id: accountId } });
  if (!existing) return NextResponse.json({ error: "账户不存在" }, { status: 404 });

  await db.hfAccount.delete({ where: { id: accountId } });
  return NextResponse.json({ ok: true });
}
