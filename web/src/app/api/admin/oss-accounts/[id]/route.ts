import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { encryptSecret, decryptSecret, maskSecret } from "@/lib/secret-crypto";

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

const patchSchema = z
  .object({
    label: z.string().min(1).max(80).optional(),
    provider: z.enum(["s3", "aliyun", "minio", "r2"]).optional(),
    endpoint: z.string().min(3).max(300).optional(),
    region: z.string().max(80).optional(),
    bucket: z.string().min(1).max(128).optional(),
    access_key_id: z.string().min(1).max(200).optional(),
    secret_access_key: z.string().min(1).max(300).optional(),
    public_base_url: z.string().url().nullable().optional(),
    path_prefix: z.string().max(128).optional(),
    mirror_zen_results: z.boolean().optional(),
    force_path_style: z.boolean().optional(),
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

  const existing = await db.ossAccount.findUnique({ where: { id: accountId } });
  if (!existing) return NextResponse.json({ error: "账户不存在" }, { status: 404 });

  const account = await db.$transaction(async (tx) => {
    if (data.activate === true) {
      await tx.ossAccount.updateMany({ where: { isActive: true }, data: { isActive: false } });
    }
    return tx.ossAccount.update({
      where: { id: accountId },
      data: {
        ...(data.label !== undefined ? { label: data.label } : {}),
        ...(data.provider !== undefined ? { provider: data.provider } : {}),
        ...(data.endpoint !== undefined ? { endpoint: data.endpoint.trim() } : {}),
        ...(data.region !== undefined ? { region: data.region } : {}),
        ...(data.bucket !== undefined ? { bucket: data.bucket.trim() } : {}),
        ...(data.access_key_id !== undefined ? { accessKeyId: data.access_key_id.trim() } : {}),
        ...(data.secret_access_key !== undefined
          ? { secretAccessKeyEnc: encryptSecret(data.secret_access_key.trim()) }
          : {}),
        ...(data.public_base_url !== undefined
          ? { publicBaseUrl: data.public_base_url?.trim() || null }
          : {}),
        ...(data.path_prefix !== undefined ? { pathPrefix: data.path_prefix.trim() || "media" } : {}),
        ...(data.mirror_zen_results !== undefined ? { mirrorZenResults: data.mirror_zen_results } : {}),
        ...(data.force_path_style !== undefined ? { forcePathStyle: data.force_path_style } : {}),
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

  const existing = await db.ossAccount.findUnique({ where: { id: accountId } });
  if (!existing) return NextResponse.json({ error: "账户不存在" }, { status: 404 });

  await db.ossAccount.delete({ where: { id: accountId } });
  return NextResponse.json({ ok: true });
}
