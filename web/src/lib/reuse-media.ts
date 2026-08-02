import "server-only";
import { db } from "./db";
import { normalizeDeleteReason } from "./media-delete-reason";

/**
 * 「套用 / 重新生成」之前必须先确认：当初喂进去的媒体还在不在。
 *
 * 在 → 直接把 URL 填回表单；
 * 不在 → 前端弹框告诉用户是哪个文件、什么时候传的、什么时候被清理的、为什么，
 *        然后只恢复参数、留空媒体，让用户自己重新上传。
 */

export type ReuseMediaItem = {
  url: string;
  available: boolean;
  filename: string | null;
  uploaded_at: string | null;
  deleted_at: string | null;
  /** 机器码，展示文案由前端按 i18n 映射 */
  delete_reason: string | null;
};

export type ReuseMediaStatus = {
  /** 全部输入媒体都还在（没有输入媒体时也算 true） */
  all_available: boolean;
  items: ReuseMediaItem[];
  /** 仍可用的 URL，直接回填表单 */
  usable_urls: string[];
};

/**
 * @param channel  main = 创作中心，plaything = 玩物专区
 * @param sourceId 对应的生成记录 id
 * @param paramUrls params 里还留着的输入媒体 URL
 */
export async function resolveInputMediaStatus(opts: {
  userId: number;
  channel: "main" | "plaything";
  sourceId: number;
  paramUrls: string[];
}): Promise<ReuseMediaStatus> {
  const { userId, channel, sourceId, paramUrls } = opts;

  // 按来源取台账：清理任务会把已删的 URL 从 params 里抹掉，
  // 所以「params 里没有、台账里有且已删」正是需要提示的那一类
  const assets = await db.mediaAsset.findMany({
    where: { userId, kind: "upload", channel, sourceId },
    orderBy: { createdAt: "asc" },
  });

  const byUrl = new Map(assets.map((a) => [a.url, a]));
  const items: ReuseMediaItem[] = [];
  const seen = new Set<string>();

  // 1) params 里还在的：多数情况下都可用
  for (const url of paramUrls) {
    if (seen.has(url)) continue;
    seen.add(url);
    const asset = byUrl.get(url);
    const deleted = Boolean(asset?.deletedAt);
    items.push({
      url,
      available: !deleted,
      filename: asset?.filename ?? null,
      uploaded_at: asset?.createdAt?.toISOString() ?? null,
      deleted_at: asset?.deletedAt?.toISOString() ?? null,
      delete_reason: deleted ? normalizeDeleteReason(asset?.deleteReason) : null,
    });
  }

  // 2) 台账里已删、params 里已被抹掉的：这些才是要弹框说明的
  for (const asset of assets) {
    if (seen.has(asset.url) || !asset.deletedAt) continue;
    seen.add(asset.url);
    items.push({
      url: asset.url,
      available: false,
      filename: asset.filename,
      uploaded_at: asset.createdAt.toISOString(),
      deleted_at: asset.deletedAt.toISOString(),
      delete_reason: normalizeDeleteReason(asset.deleteReason),
    });
  }

  return {
    all_available: items.every((i) => i.available),
    items,
    usable_urls: items.filter((i) => i.available).map((i) => i.url),
  };
}
