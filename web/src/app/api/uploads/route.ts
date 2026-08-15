import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getCurrentUser } from "@/lib/auth";
import { deleteObjectKey, uploadBufferWithMeta, ossConfigured } from "@/lib/oss";
import { contentAddressedPath, findReusableUpload, sha256OfBuffer } from "@/lib/media-dedup";
import { mergeMediaPolicy } from "@/lib/plaything-param-policy";
import { extForMime, validateUploadedMedia } from "@/lib/plaything-media-validate";
import { createMediaAssetCompat } from "@/lib/media-asset-compat";
import { sanitizeFilename } from "@/lib/media-delete-reason";
import { uploadMediaExpiry } from "@/lib/media-retention";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * 创作中心（/make）的输入媒体上传。
 *
 * 为什么不继续走 base64 内联：
 * 视频转视频与对口型要传的是视频和音频，动辄几十 MB，
 * 塞进 JSON 请求体既过不了体积上限，也会把整段二进制压进 Generation.params。
 * 这里与玩物专区共用同一套校验（MIME 白名单、尺寸/时长上限）与 MediaAsset 登记，
 * 只是 channel 记成 main —— 清理策略按 channel 分别配置。
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!rateLimit(`upload:${user.id}`, 30, 60_000)) {
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

  // 生成端的档位没有 paramPolicy，直接用该媒体类型的默认约束
  const policy = mergeMediaPolicy(field, null, kind);

  const buffer = Buffer.from(await file.arrayBuffer());
  let validated;
  try {
    validated = validateUploadedMedia({
      buffer,
      declaredMime: file.type || "",
      kind,
      policy,
      meta: {
        width: numOrUndef(form.get("width")),
        height: numOrUndef(form.get("height")),
        duration_sec: numOrUndef(form.get("duration_sec")),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }

  const ext = extForMime(validated.contentType);
  const sha256 = sha256OfBuffer(buffer);

  /*
   * 上传物与生成结果分开放：生成结果在 generations/{生成id}/，上传物在 uploads/。
   * 早先两边都写 generations/，但一个按用户 id、一个按生成 id——两个完全不同的
   * ID 空间挤在同一命名空间里，光看路径分不出来，按前缀做批量操作必然误伤。
   *
   * 上传物再进一步用内容寻址（uploads/sha256/<hash>.<ext>）：
   * key 由内容决定，同样的字节必然落在同一个对象上，天然不会存两份；
   * 也不把用户 id 写进路径——否则复用方拿到的 URL 会露出首传者的 id。
   */
  const relativePath = contentAddressedPath(sha256, ext);

  try {
    // 库里已有同内容且对象还在当前桶上，直接复用，省掉一次上传
    const reuse = await findReusableUpload(sha256);
    const uploaded = reuse
      ? { url: reuse.url, objectKey: reuse.objectKey, config: null }
      : await uploadBufferWithMeta(buffer, relativePath, validated.contentType);

    let asset;
    let expiresAt;
    try {
      expiresAt = await uploadMediaExpiry();
      asset = await createMediaAssetCompat({
        userId: user.id,
        kind: "upload",
        channel: "main",
        url: uploaded.url,
        objectKey: uploaded.objectKey,
        contentType: validated.contentType,
        bytes: validated.bytes,
        filename: sanitizeFilename(file.name),
        sha256,
        retentionAssigned: true,
        expiresAt,
      });
    } catch (error) {
      /*
       * 登记失败要回收刚传上去的对象，别在 OSS 里留永不回收的孤儿。
       * 但复用的对象绝不能删——它是别人的文件，我们只是引用了一下。
       */
      if (!reuse && uploaded.config) {
        await deleteObjectKey(uploaded.objectKey, uploaded.config).catch(() => undefined);
      }
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
