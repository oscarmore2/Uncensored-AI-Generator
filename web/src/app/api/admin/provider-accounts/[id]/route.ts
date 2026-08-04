import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { encryptSecret } from "@/lib/secret-crypto";
import { getAdapter, toProviderId } from "@/lib/providers";
import { providerAccountOut } from "@/lib/provider-account-serialize";

const patchSchema = z
  .object({
    label: z.string().min(1).max(80).optional(),
    api_key: z.string().min(8).max(500).optional(),
    activate: z.boolean().optional(),
    verify: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "至少提供一个字段");

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const accountId = Number((await ctx.params).id);
  if (!Number.isInteger(accountId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, { status: 400 });
  }
  const data = parsed.data;

  const existing = await db.providerAccount.findUnique({ where: { id: accountId } });
  if (!existing) return NextResponse.json({ error: "账户不存在" }, { status: 404 });
  const provider = toProviderId(existing.provider);

  if (data.api_key && data.verify !== false) {
    try {
      await getAdapter(provider).testKey(data.api_key);
    } catch (err) {
      return NextResponse.json(
        { error: `无法验证 Key: ${err instanceof Error ? err.message : err}` },
        { status: 400 }
      );
    }
  }

  const account = await db.$transaction(async (tx) => {
    if (data.activate === true) {
      // 只停用同一渠道的其它账户：激活 Atlas 不该把 WaveSpeed 也关掉
      await tx.providerAccount.updateMany({
        where: { provider, isActive: true },
        data: { isActive: false },
      });
    }
    return tx.providerAccount.update({
      where: { id: accountId },
      data: {
        ...(data.label !== undefined ? { label: data.label } : {}),
        ...(data.api_key !== undefined ? { apiKeyEnc: encryptSecret(data.api_key) } : {}),
        ...(data.activate === true ? { isActive: true } : {}),
        ...(data.activate === false ? { isActive: false } : {}),
      },
    });
  });

  return NextResponse.json({ ok: true, account: providerAccountOut(account) });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const accountId = Number((await ctx.params).id);
  if (!Number.isInteger(accountId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const existing = await db.providerAccount.findUnique({ where: { id: accountId } });
  if (!existing) return NextResponse.json({ error: "账户不存在" }, { status: 404 });

  await db.providerAccount.delete({ where: { id: accountId } });
  return NextResponse.json({ ok: true });
}
