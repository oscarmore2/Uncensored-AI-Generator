import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { encryptSecret, decryptSecret, maskSecret } from "@/lib/secret-crypto";
import { env } from "@/lib/env";

function accountOut(a: {
  id: number;
  label: string;
  provider: string;
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKeyEnc: string;
  publicBaseUrl: string | null;
  pathPrefix: string;
  mirrorZenResults: boolean;
  forcePathStyle: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  let secretMask = "****";
  try {
    secretMask = maskSecret(decryptSecret(a.secretAccessKeyEnc));
  } catch {
    secretMask = "(解密失败)";
  }
  return {
    id: a.id,
    label: a.label,
    provider: a.provider,
    endpoint: a.endpoint,
    region: a.region,
    bucket: a.bucket,
    access_key_id: a.accessKeyId,
    secret_key_mask: secretMask,
    public_base_url: a.publicBaseUrl,
    path_prefix: a.pathPrefix,
    mirror_zen_results: a.mirrorZenResults,
    force_path_style: a.forcePathStyle,
    is_active: a.isActive,
    created_at: a.createdAt,
    updated_at: a.updatedAt,
  };
}

export async function GET() {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const accounts = await db.ossAccount.findMany({
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
  });
  const activeFromDb = accounts.some((a) => a.isActive);
  const envConfigured = Boolean(
    env.OSS_ENDPOINT && env.OSS_BUCKET && env.OSS_ACCESS_KEY_ID && env.OSS_SECRET_ACCESS_KEY
  );

  return NextResponse.json({
    accounts: accounts.map(accountOut),
    env_fallback: {
      configured: envConfigured,
      endpoint: env.OSS_ENDPOINT || null,
      bucket: env.OSS_BUCKET || null,
      access_key_id: env.OSS_ACCESS_KEY_ID || null,
      secret_key_mask: env.OSS_SECRET_ACCESS_KEY ? maskSecret(env.OSS_SECRET_ACCESS_KEY) : null,
      public_base_url: env.OSS_PUBLIC_BASE_URL || null,
      mirror_zen_results: env.OSS_MIRROR_ZEN_RESULTS,
      in_use: !activeFromDb && envConfigured,
    },
  });
}

const createSchema = z.object({
  label: z.string().min(1).max(80),
  provider: z.enum(["s3", "aliyun", "minio", "r2"]).default("s3"),
  endpoint: z.string().min(3).max(300),
  region: z.string().max(80).optional().default("us-east-1"),
  bucket: z.string().min(1).max(128),
  access_key_id: z.string().min(1).max(200),
  secret_access_key: z.string().min(1).max(300),
  public_base_url: z.string().url().optional().nullable(),
  path_prefix: z.string().max(128).optional().default("media"),
  mirror_zen_results: z.boolean().optional().default(true),
  force_path_style: z.boolean().optional(),
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

  const forcePathStyle =
    data.force_path_style ??
    (data.provider === "minio" ? true : data.provider === "aliyun" ? false : false);

  const account = await db.$transaction(async (tx) => {
    if (data.activate) {
      await tx.ossAccount.updateMany({ where: { isActive: true }, data: { isActive: false } });
    }
    return tx.ossAccount.create({
      data: {
        label: data.label.trim(),
        provider: data.provider,
        endpoint: data.endpoint.trim(),
        region: data.region?.trim() || "us-east-1",
        bucket: data.bucket.trim(),
        accessKeyId: data.access_key_id.trim(),
        secretAccessKeyEnc: encryptSecret(data.secret_access_key.trim()),
        publicBaseUrl: data.public_base_url?.trim() || null,
        pathPrefix: data.path_prefix?.trim() || "media",
        mirrorZenResults: data.mirror_zen_results,
        forcePathStyle,
        isActive: data.activate,
      },
    });
  });

  return NextResponse.json({ ok: true, account: accountOut(account) }, { status: 201 });
}
