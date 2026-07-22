import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { encryptSecret, decryptSecret, maskSecret } from "@/lib/secret-crypto";
import { env } from "@/lib/env";

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

export async function GET() {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const accounts = await db.stripeAccount.findMany({
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
  });
  const activeFromDb = accounts.some((a) => a.isActive);

  return NextResponse.json({
    accounts: accounts.map(accountOut),
    env_fallback: {
      configured: Boolean(env.STRIPE_SECRET_KEY),
      webhook_configured: Boolean(env.STRIPE_WEBHOOK_SECRET),
      secret_key_mask: env.STRIPE_SECRET_KEY ? maskSecret(env.STRIPE_SECRET_KEY) : null,
      in_use: !activeFromDb && Boolean(env.STRIPE_SECRET_KEY),
    },
  });
}

const createSchema = z.object({
  label: z.string().min(1).max(80),
  secret_key: z.string().min(10).max(300),
  webhook_secret: z.string().min(10).max(300),
  publishable_key: z.string().max(300).optional().nullable(),
  activate: z.boolean().optional().default(false),
});

export async function POST(req: Request) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, { status: 400 });
  }
  const data = parsed.data;

  if (!data.secret_key.startsWith("sk_")) {
    return NextResponse.json({ error: "Secret Key 应以 sk_ 开头" }, { status: 400 });
  }
  if (!data.webhook_secret.startsWith("whsec_")) {
    return NextResponse.json({ error: "Webhook Secret 应以 whsec_ 开头" }, { status: 400 });
  }
  if (data.publishable_key && data.publishable_key.length > 0 && !data.publishable_key.startsWith("pk_")) {
    return NextResponse.json({ error: "Publishable Key 应以 pk_ 开头" }, { status: 400 });
  }

  const account = await db.$transaction(async (tx) => {
    if (data.activate) {
      await tx.stripeAccount.updateMany({ where: { isActive: true }, data: { isActive: false } });
    }
    return tx.stripeAccount.create({
      data: {
        label: data.label,
        secretKeyEnc: encryptSecret(data.secret_key),
        webhookSecretEnc: encryptSecret(data.webhook_secret),
        publishableKey: data.publishable_key?.trim() || null,
        isActive: data.activate,
      },
    });
  });

  return NextResponse.json({ ok: true, account: accountOut(account) }, { status: 201 });
}
