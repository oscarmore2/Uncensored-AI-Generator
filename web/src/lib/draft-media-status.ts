import "server-only";
import { db } from "./db";
import { decodeDraftSnapshot } from "./draft-snapshot";
import { normalizeDeleteReason } from "./media-delete-reason";

/**
 * 草稿引用的素材还在不在。
 *
 * 草稿存的是素材 URL，而上传件默认只留 7 天（VIP2 及以上永久）。所以一份放了
 * 几天的草稿，点开很可能引用着已经被清理掉的图——不提前说，用户要到点了生成
 * 才发现，白等一次。
 *
 * 判定口径跟 reuse-media 一致：**只有台账里明确标了 deletedAt 才算失效**。
 * 查不到台账记录的一律当作可用——老数据本来就没有台账，把它们报成「已失效」
 * 是误伤，而误伤的代价（用户以为素材没了、重传一遍）比漏报更糟。
 */

export type DraftMediaGone = {
  url: string;
  name: string;
  deleted_at: string | null;
  delete_reason: string | null;
};

export type DraftMediaStatus = {
  /** 草稿一共引用了几份素材 */
  total: number;
  /** 其中已被清理的 */
  gone: DraftMediaGone[];
  /** 仍然存活的素材里最早的到期时间；全是永久保留时为 null */
  expires_at: string | null;
};

const EMPTY: DraftMediaStatus = { total: 0, gone: [], expires_at: null };

/** 一次查完一批草稿，别在卡片列表里逐条打库 */
export async function draftMediaStatuses(
  userId: number,
  drafts: Array<{ id: number; snapshot: string }>
): Promise<Map<number, DraftMediaStatus>> {
  const out = new Map<number, DraftMediaStatus>();
  const urlsByDraft = new Map<number, { url: string; name: string }[]>();
  const all = new Set<string>();

  for (const draft of drafts) {
    const snap = decodeDraftSnapshot(draft.snapshot);
    const items = Object.values(snap.media)
      .flat()
      .map((m) => ({ url: m.url, name: m.name }));
    urlsByDraft.set(draft.id, items);
    for (const item of items) all.add(item.url);
  }

  if (all.size === 0) {
    for (const draft of drafts) out.set(draft.id, EMPTY);
    return out;
  }

  let assets: Array<{
    url: string;
    filename: string | null;
    deletedAt: Date | null;
    deleteReason: string | null;
    expiresAt: Date | null;
  }>;
  try {
    assets = await db.mediaAsset.findMany({
      where: { userId, kind: "upload", url: { in: [...all] } },
      select: { url: true, filename: true, deletedAt: true, deleteReason: true, expiresAt: true },
    });
  } catch (err) {
    // 台账查不动时不猜：宁可什么都不提示，也不要报一堆假的「素材已失效」
    console.error("[draft] 媒体台账不可用，跳过失效判定：", err);
    for (const draft of drafts) out.set(draft.id, EMPTY);
    return out;
  }

  const byUrl = new Map(assets.map((a) => [a.url, a]));

  for (const draft of drafts) {
    const items = urlsByDraft.get(draft.id) ?? [];
    const gone: DraftMediaGone[] = [];
    let earliest: Date | null = null;

    for (const item of items) {
      const asset = byUrl.get(item.url);
      if (asset?.deletedAt) {
        gone.push({
          url: item.url,
          name: asset.filename ?? item.name,
          deleted_at: asset.deletedAt.toISOString(),
          delete_reason: normalizeDeleteReason(asset.deleteReason),
        });
        continue;
      }
      if (asset?.expiresAt && (!earliest || asset.expiresAt < earliest)) earliest = asset.expiresAt;
    }

    out.set(draft.id, {
      total: items.length,
      gone,
      expires_at: earliest?.toISOString() ?? null,
    });
  }

  return out;
}
