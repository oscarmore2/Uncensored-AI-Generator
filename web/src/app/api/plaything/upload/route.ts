import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { hasPlaythingAccess } from "@/lib/plaything-access";
import { deleteObjectKey, uploadBufferWithMeta, ossConfigured } from "@/lib/oss";
import { mergeMediaPolicy } from "@/lib/plaything-param-policy";
import { extForMime, validateUploadedMedia } from "@/lib/plaything-media-validate";
import { rateLimit } from "@/lib/rate-limit";
import { uploadMediaExpiry } from "@/lib/media-retention";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPlaythingAccess(user)) {
    return NextResponse.json({ error: "无玩物专区访问权限" }, { status: 403 });
  }

  if (!rateLimit(`plaything-upload:${user.id}`, 30, 60_000)) {
    return NextResponse.json({ error: "上传过于频繁" }, { status: 429 });
  }

  if (!(await ossConfigured())) {
    return NextResponse.json({ error: "对象存储未配置，无法上传" }, { status: 503 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "无效表单" }, { status: 400 });

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "缺少 file" }, { status: 400 });
  }

  const kindRaw = String(form.get("kind") || "image");
  const kind = (["image", "video", "audio"].includes(kindRaw) ? kindRaw : "image") as
    | "image"
    | "video"
    | "audio";
  const field = String(form.get("field") || kind);
  const productId = Number(form.get("product_id") || 0);

  let policyRaw: string | null = null;
  if (Number.isInteger(productId) && productId > 0) {
    const product = await db.waveSpeedProduct.findFirst({
      where: { id: productId, isActive: true },
      select: { paramPolicy: true },
    });
    policyRaw = product?.paramPolicy ?? null;
  }
  const policy = mergeMediaPolicy(field, policyRaw, kind);

  const buffer = Buffer.from(await file.arrayBuffer());
  const meta = {
    width: numOrUndef(form.get("width")),
    height: numOrUndef(form.get("height")),
    duration_sec: numOrUndef(form.get("duration_sec")),
  };

  let validated;
  try {
    validated = validateUploadedMedia({
      buffer,
      declaredMime: file.type || "",
      kind,
      policy,
      meta,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }

  const ext = extForMime(validated.contentType);
  const relativePath = `plaything/${user.id}/${randomUUID()}.${ext}`;

  try {
    const uploaded = await uploadBufferWithMeta(buffer, relativePath, validated.contentType);
    let asset;
    let expiresAt;
    try {
      expiresAt = await uploadMediaExpiry();
      asset = await db.mediaAsset.create({
        data: {
          userId: user.id,
          kind: "upload",
          channel: "wavespeed",
          url: uploaded.url,
          objectKey: uploaded.objectKey,
          contentType: validated.contentType,
          bytes: validated.bytes,
          retentionAssigned: true,
          expiresAt,
        },
      });
    } catch (error) {
      await deleteObjectKey(uploaded.objectKey, uploaded.config).catch(() => undefined);
      throw error;
    }
    return NextResponse.json({
      url: uploaded.url,
      asset_id: asset.id,
      expires_at: expiresAt,
      content_type: validated.contentType,
      bytes: validated.bytes,
      width: validated.width ?? null,
      height: validated.height ?? null,
      duration_sec: validated.duration_sec ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "上传失败" },
      { status: 500 }
    );
  }
}

function numOrUndef(v: FormDataEntryValue | null): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
