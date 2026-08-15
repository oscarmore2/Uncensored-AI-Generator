import "server-only";
import { createHash } from "crypto";
import { db } from "./db";
import { getActiveOssConfig, objectKeyFromPublicUrl } from "./oss";

/**
 * 上传去重（秒传）。
 *
 * 同一张参考图被反复上传是常态——用户重试、换个档位再跑一次、多人用同一张素材。
 * 每次都占一份空间没有意义，内容一样就复用同一个对象。
 *
 * 两层保证：
 *
 * 1. **内容寻址的 objectKey**（uploads/sha256/<hash>.<ext>）。
 *    key 由内容决定，同样的字节必然落在同一个 key 上。即便数据库那条记录
 *    因为清理没了，重新上传也只是覆盖同一个对象，不会长出第二份。
 *
 * 2. **查库命中就完全跳过上传**。省掉一次几 MB 的网络往返。
 *
 * 代价是删除不能再想删就删：多条 MediaAsset 会共用一个 objectKey，
 * 物理删除前必须确认没有别的存活记录还指着它。见 media-cleanup.ts 里的
 * objectStillReferenced。这两件事是一套的，只做去重不做引用计数会删坏别人的文件。
 */

export function sha256OfBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** 内容寻址的对象路径。不带用户 id——那样会让复用方的 URL 里露出首传者的 id */
export function contentAddressedPath(sha256: string, ext: string): string {
  return `uploads/sha256/${sha256}.${ext}`;
}

export interface ReusableUpload {
  url: string;
  objectKey: string;
  bytes: number | null;
  contentType: string | null;
}

/**
 * 找一条内容相同、还活着、且对象确实在当前激活 OSS 上的记录。
 *
 * 最后一个条件不能省：换过 OSS 账户之后，老记录的 URL 指向旧桶，
 * 复用它等于把新用户的文件挂到一个我们已经不再管理的地方。
 */
export async function findReusableUpload(sha256: string): Promise<ReusableUpload | null> {
  const cfg = await getActiveOssConfig();
  if (!cfg) return null;

  const candidates = await db.mediaAsset.findMany({
    where: { sha256, deletedAt: null, objectKey: { not: null } },
    orderBy: { id: "asc" },
    take: 10,
    select: { url: true, objectKey: true, bytes: true, contentType: true },
  });

  for (const c of candidates) {
    if (!c.objectKey) continue;
    // URL 必须能被当前账户反解出 key，否则它不在这个桶里
    if (objectKeyFromPublicUrl(cfg, c.url) === null) continue;
    return { url: c.url, objectKey: c.objectKey, bytes: c.bytes, contentType: c.contentType };
  }
  return null;
}

/**
 * 该对象是否还被别的存活记录引用着。
 * 物理删除前必须问一次——去重之后一个对象可能对应多条记录。
 */
export async function objectStillReferenced(
  objectKey: string,
  excludeAssetId: number
): Promise<boolean> {
  const n = await db.mediaAsset.count({
    where: { objectKey, deletedAt: null, id: { not: excludeAssetId } },
  });
  return n > 0;
}
