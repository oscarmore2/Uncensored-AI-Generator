import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { encryptSecret, decryptSecret, maskSecret } from "@/lib/secret-crypto";
import { env } from "@/lib/env";

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

/** 列出所有 Cryptomus 商户（API Key 仅掩码）+ env 兜底状态 */
export async function GET() {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const merchants = await db.cryptomusMerchant.findMany({ orderBy: [{ isActive: "desc" }, { createdAt: "desc" }] });
  const activeFromDb = merchants.some((m) => m.isActive);

  return NextResponse.json({
    merchants: merchants.map(merchantOut),
    env_fallback: {
      configured: Boolean(env.CRYPTOMUS_MERCHANT_ID && env.CRYPTOMUS_PAYMENT_API_KEY),
      merchant_id_mask: env.CRYPTOMUS_MERCHANT_ID
        ? `${env.CRYPTOMUS_MERCHANT_ID.slice(0, 8)}…`
        : null,
      in_use: !activeFromDb && Boolean(env.CRYPTOMUS_MERCHANT_ID && env.CRYPTOMUS_PAYMENT_API_KEY),
    },
  });
}

const createSchema = z.object({
  label: z.string().min(1).max(80),
  merchant_id: z.string().min(8).max(120),
  payment_api_key: z.string().min(8).max(200),
  activate: z.boolean().optional().default(false),
});

/** 新增商户；可选立即激活（会取消其他激活） */
export async function POST(req: Request) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, { status: 400 });
  }
  const data = parsed.data;

  const exists = await db.cryptomusMerchant.findUnique({ where: { merchantId: data.merchant_id } });
  if (exists) {
    return NextResponse.json({ error: "该 Merchant ID 已存在" }, { status: 409 });
  }

  const merchant = await db.$transaction(async (tx) => {
    if (data.activate) {
      await tx.cryptomusMerchant.updateMany({ where: { isActive: true }, data: { isActive: false } });
    }
    return tx.cryptomusMerchant.create({
      data: {
        label: data.label,
        merchantId: data.merchant_id,
        paymentApiKeyEnc: encryptSecret(data.payment_api_key),
        isActive: data.activate,
      },
    });
  });

  return NextResponse.json({ ok: true, merchant: merchantOut(merchant) }, { status: 201 });
}
