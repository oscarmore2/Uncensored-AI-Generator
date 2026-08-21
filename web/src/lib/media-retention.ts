import "server-only";
import { db } from "./db";
import { isVip2OrAbove } from "./pricing";

export type MediaPolicyKey = {
  mediaType: "upload" | "generated";
  channel: "all" | "main" | "plaything";
  /**
   * vip2 只用在上传件上：生成结果只要是 VIP 就已经永久保留，再分等级没有意义；
   * 上传的参考素材则默认对所有人 7 天，VIP2 及以上才免清理。
   */
  audience: "all" | "non_vip" | "vip" | "vip2";
};

export const DEFAULT_MEDIA_POLICIES: Array<MediaPolicyKey & { retentionDays: number | null }> = [
  { mediaType: "upload", channel: "all", audience: "all", retentionDays: 7 },
  { mediaType: "upload", channel: "all", audience: "vip2", retentionDays: null },
  { mediaType: "generated", channel: "main", audience: "non_vip", retentionDays: 7 },
  { mediaType: "generated", channel: "main", audience: "vip", retentionDays: null },
  { mediaType: "generated", channel: "plaything", audience: "non_vip", retentionDays: 7 },
  { mediaType: "generated", channel: "plaything", audience: "vip", retentionDays: null },
];

export async function ensureMediaCleanupPolicies() {
  await db.mediaCleanupPolicy.createMany({
    data: DEFAULT_MEDIA_POLICIES,
    skipDuplicates: true,
  });
}

export async function retentionDaysFor(key: MediaPolicyKey): Promise<number | null> {
  await ensureMediaCleanupPolicies();
  const policy = await db.mediaCleanupPolicy.findUnique({
    where: {
      mediaType_channel_audience: {
        mediaType: key.mediaType,
        channel: key.channel,
        audience: key.audience,
      },
    },
  });
  const fallback = DEFAULT_MEDIA_POLICIES.find(
    (item) =>
      item.mediaType === key.mediaType &&
      item.channel === key.channel &&
      item.audience === key.audience
  );
  return policy?.retentionDays ?? fallback?.retentionDays ?? null;
}

export function expiresAtFromDays(createdAt: Date, retentionDays: number | null): Date | null {
  if (retentionDays === null) return null;
  return new Date(createdAt.getTime() + retentionDays * 24 * 60 * 60 * 1000);
}

export async function generatedMediaExpiry(
  channel: "main" | "plaything",
  ownerVipAtCreation: boolean,
  createdAt = new Date()
) {
  const retentionDays = await retentionDaysFor({
    mediaType: "generated",
    channel,
    audience: ownerVipAtCreation ? "vip" : "non_vip",
  });
  return expiresAtFromDays(createdAt, retentionDays);
}

/**
 * 上传素材的到期时间。
 *
 * 注意这里传的是**上传当时**的 VIP2 状态，跟生成结果的 ownerVipAtCreation 一个道理：
 * 会员到期后不去追杀已经存下来的东西，否则用户续费的间隙里素材就没了，
 * 而他手上的草稿正引用着这些素材。
 */
export async function uploadMediaExpiry(vip2AtUpload: boolean, createdAt = new Date()) {
  const retentionDays = await retentionDaysFor({
    mediaType: "upload",
    channel: "all",
    audience: vip2AtUpload ? "vip2" : "all",
  });
  return expiresAtFromDays(createdAt, retentionDays);
}

/**
 * 只拿得到 userId 的调用方用这个（比如生成任务里落参考图）。
 * 多一次很轻的查询，换调用方不必把 VIP 状态一路透传下去。
 */
export async function uploadMediaExpiryForUser(userId: number, createdAt = new Date()) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { isVip: true, vipExpiresAt: true, vipTier: { select: { rank: true } } },
  });
  return uploadMediaExpiry(isVip2OrAbove(user), createdAt);
}

/**
 * 为上线该功能前创建、尚无到期字段的媒体补齐策略。
 * 旧数据没有“创建时 VIP”快照，因此仅在这次兼容补齐时以当前有效 VIP 状态推断。
 */
export async function backfillMissingMediaExpirations(): Promise<number> {
  await ensureMediaCleanupPolicies();
  const now = new Date();
  const [mainNonVipDays, playthingNonVipDays, uploadDays] = await Promise.all([
    retentionDaysFor({ mediaType: "generated", channel: "main", audience: "non_vip" }),
    retentionDaysFor({ mediaType: "generated", channel: "plaything", audience: "non_vip" }),
    retentionDaysFor({ mediaType: "upload", channel: "all", audience: "all" }),
  ]);
  const [generations, waveGenerations, uploads] = await Promise.all([
    db.generation.findMany({
      where: {
        retentionAssigned: false,
        mediaDeletedAt: null,
        visibility: { not: "featured" },
      },
      select: {
        id: true,
        createdAt: true,
        ownerVipAtCreation: true,
        user: { select: { isVip: true, vipExpiresAt: true } },
      },
    }),
    db.playthingGeneration.findMany({
      where: { retentionAssigned: false, mediaDeletedAt: null },
      select: {
        id: true,
        createdAt: true,
        ownerVipAtCreation: true,
        user: { select: { isVip: true, vipExpiresAt: true } },
      },
    }),
    db.mediaAsset.findMany({
      where: { retentionAssigned: false, deletedAt: null, kind: "upload" },
      select: { id: true, createdAt: true },
    }),
  ]);

  const isCurrentVip = (user: { isVip: boolean; vipExpiresAt: Date | null }) =>
    user.isVip && (!user.vipExpiresAt || user.vipExpiresAt > now);
  const updates = [
    ...generations.map((item) => {
      const vip = item.ownerVipAtCreation || isCurrentVip(item.user);
      return db.generation.update({
        where: { id: item.id },
        data: {
          ownerVipAtCreation: vip,
          retentionAssigned: true,
          mediaExpiresAt: expiresAtFromDays(item.createdAt, vip ? null : mainNonVipDays),
        },
      });
    }),
    ...waveGenerations.map((item) => {
      const vip = item.ownerVipAtCreation || isCurrentVip(item.user);
      return db.playthingGeneration.update({
        where: { id: item.id },
        data: {
          ownerVipAtCreation: vip,
          retentionAssigned: true,
          mediaExpiresAt: expiresAtFromDays(item.createdAt, vip ? null : playthingNonVipDays),
        },
      });
    }),
    ...uploads.map((item) =>
      db.mediaAsset.update({
        where: { id: item.id },
        data: {
          retentionAssigned: true,
          expiresAt: expiresAtFromDays(item.createdAt, uploadDays),
        },
      })
    ),
  ];
  for (let index = 0; index < updates.length; index += 100) {
    await db.$transaction(updates.slice(index, index + 100));
  }
  return updates.length;
}

/** 管理员修改策略后，重算尚未精选、尚未清理的现有媒体到期时间。 */
export async function recalculateMediaExpirations(): Promise<number> {
  await ensureMediaCleanupPolicies();
  const policies = await db.mediaCleanupPolicy.findMany();
  const policyMap = new Map(
    policies.map((item) => [
      `${item.mediaType}:${item.channel}:${item.audience}`,
      item.retentionDays,
    ])
  );

  const [generations, waveGenerations, uploads] = await Promise.all([
    db.generation.findMany({
      where: { mediaDeletedAt: null, visibility: { not: "featured" } },
      select: { id: true, createdAt: true, ownerVipAtCreation: true },
    }),
    db.playthingGeneration.findMany({
      where: { mediaDeletedAt: null },
      select: { id: true, createdAt: true, ownerVipAtCreation: true },
    }),
    db.mediaAsset.findMany({
      where: { deletedAt: null, kind: "upload" },
      select: { id: true, createdAt: true },
    }),
  ]);

  const updates = [
    ...generations.map((item) =>
      db.generation.update({
        where: { id: item.id },
        data: {
          retentionAssigned: true,
          mediaExpiresAt: expiresAtFromDays(
            item.createdAt,
            policyMap.get(`generated:main:${item.ownerVipAtCreation ? "vip" : "non_vip"}`) ?? null
          ),
        },
      })
    ),
    ...waveGenerations.map((item) =>
      db.playthingGeneration.update({
        where: { id: item.id },
        data: {
          retentionAssigned: true,
          mediaExpiresAt: expiresAtFromDays(
            item.createdAt,
            policyMap.get(`generated:plaything:${item.ownerVipAtCreation ? "vip" : "non_vip"}`) ?? null
          ),
        },
      })
    ),
    ...uploads.map((item) =>
      db.mediaAsset.update({
        where: { id: item.id },
        data: {
          retentionAssigned: true,
          expiresAt: expiresAtFromDays(
            item.createdAt,
            policyMap.get("upload:all:all") ?? null
          ),
        },
      })
    ),
  ];

  for (let index = 0; index < updates.length; index += 100) {
    await db.$transaction(updates.slice(index, index + 100));
  }
  return updates.length;
}
