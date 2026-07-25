import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { requireRole } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/csrf";
import {
  decryptSecret,
  encryptSecret,
  maskSecret,
} from "@/lib/secret-crypto";
import { logAdminAction } from "@/lib/admin-audit";

function accountOut(account: {
  id: number;
  label: string;
  apiKeyEnc: string;
  ipnSecretEnc: string;
  baseUrl: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  let apiKeyMask = "(解密失败)";
  let ipnSecretMask = "(解密失败)";
  try {
    apiKeyMask = maskSecret(decryptSecret(account.apiKeyEnc));
  } catch {}
  try {
    ipnSecretMask = maskSecret(decryptSecret(account.ipnSecretEnc));
  } catch {}
  return {
    id: account.id,
    label: account.label,
    api_key_mask: apiKeyMask,
    ipn_secret_mask: ipnSecretMask,
    base_url: account.baseUrl,
    is_active: account.isActive,
    created_at: account.createdAt,
    updated_at: account.updatedAt,
  };
}

export async function GET() {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const accounts = await db.nowPaymentsAccount.findMany({
    orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
  });
  const activeDb = accounts.some((account) => account.isActive);
  return NextResponse.json({
    accounts: accounts.map(accountOut),
    env_fallback: {
      configured: Boolean(env.NOWPAYMENTS_API_KEY && env.NOWPAYMENTS_IPN_SECRET),
      api_key_mask: env.NOWPAYMENTS_API_KEY
        ? maskSecret(env.NOWPAYMENTS_API_KEY)
        : null,
      ipn_secret_configured: Boolean(env.NOWPAYMENTS_IPN_SECRET),
      base_url: env.NOWPAYMENTS_BASE_URL,
      in_use:
        !activeDb &&
        Boolean(env.NOWPAYMENTS_API_KEY && env.NOWPAYMENTS_IPN_SECRET),
    },
    webhook_url: `${env.APP_URL}/api/payments/crypto/webhook`,
  });
}

const createSchema = z.object({
  label: z.string().trim().min(1).max(80),
  api_key: z.string().trim().min(8).max(500),
  ipn_secret: z.string().trim().min(8).max(500),
  base_url: z.string().url().max(500),
  activate: z.boolean().optional().default(true),
});

export async function POST(req: Request) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const origin = assertSameOrigin(req);
  if (!origin.ok) {
    return NextResponse.json({ error: origin.error }, { status: origin.status });
  }
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "参数无效" },
      { status: 400 }
    );
  }
  const data = parsed.data;
  const account = await db.$transaction(async (tx) => {
    if (data.activate) {
      await tx.nowPaymentsAccount.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      });
    }
    return tx.nowPaymentsAccount.create({
      data: {
        label: data.label,
        apiKeyEnc: encryptSecret(data.api_key),
        ipnSecretEnc: encryptSecret(data.ipn_secret),
        baseUrl: data.base_url.replace(/\/+$/, ""),
        isActive: data.activate,
      },
    });
  });
  await logAdminAction(
    admin.id,
    "nowpayments_account",
    { type: "nowpayments_account", id: account.id },
    { operation: "create", active: account.isActive, label: account.label }
  );
  return NextResponse.json(
    { ok: true, account: accountOut(account) },
    { status: 201 }
  );
}
