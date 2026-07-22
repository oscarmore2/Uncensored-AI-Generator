import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { encryptSecret, decryptSecret, maskSecret } from "@/lib/secret-crypto";

function merchantOut(m: {
  id: number;
  label: string;
  merchantId: string;
  paymentApiKeyEnc: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  let keyMask = "****";
  try {
    keyMask = maskSecret(decryptSecret(m.paymentApiKeyEnc));
  } catch {
    keyMask = "(解密失败)";
  }
  return {
    id: m.id,
    label: m.label,
    merchant_id: m.merchantId,
    api_key_mask: keyMask,
    is_active: m.isActive,
    created_at: m.createdAt,
    updated_at: m.updatedAt,
  };
}

const patchSchema = z
  .object({
    label: z.string().min(1).max(80).optional(),
    payment_api_key: z.string().min(8).max(200).optional(),
    activate: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "至少提供一个字段");

/** 更新备注/API Key，或激活该商户（激活时取消其他） */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const merchantId = Number(id);
  if (!Number.isInteger(merchantId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, { status: 400 });
  }
  const data = parsed.data;

  const existing = await db.cryptomusMerchant.findUnique({ where: { id: merchantId } });
  if (!existing) return NextResponse.json({ error: "商户不存在" }, { status: 404 });

  const merchant = await db.$transaction(async (tx) => {
    if (data.activate === true) {
      await tx.cryptomusMerchant.updateMany({ where: { isActive: true }, data: { isActive: false } });
    }
    return tx.cryptomusMerchant.update({
      where: { id: merchantId },
      data: {
        ...(data.label !== undefined ? { label: data.label } : {}),
        ...(data.payment_api_key !== undefined
          ? { paymentApiKeyEnc: encryptSecret(data.payment_api_key) }
          : {}),
        ...(data.activate === true ? { isActive: true } : {}),
        ...(data.activate === false ? { isActive: false } : {}),
      },
    });
  });

  return NextResponse.json({ ok: true, merchant: merchantOut(merchant) });
}

/** 删除商户；若正在激活则删除后无激活商户（回退 env） */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const merchantId = Number(id);
  if (!Number.isInteger(merchantId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const existing = await db.cryptomusMerchant.findUnique({ where: { id: merchantId } });
  if (!existing) return NextResponse.json({ error: "商户不存在" }, { status: 404 });

  await db.cryptomusMerchant.delete({ where: { id: merchantId } });
  return NextResponse.json({ ok: true });
}
