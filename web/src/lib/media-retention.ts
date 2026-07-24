import "server-only";
import { db } from "./db";

export type MediaPolicyKey = {
  mediaType: "upload" | "generated";
  channel: "all" | "zen" | "wavespeed";
  audience: "all" | "non_vip" | "vip";
};

export const DEFAULT_MEDIA_POLICIES: Array<MediaPolicyKey & { retentionDays: number | null }> = [
  { mediaType: "upload", channel: "all", audience: "all", retentionDays: 7 },
  { mediaType: "generated", channel: "zen", audience: "non_vip", retentionDays: 7 },
  { mediaType: "generated", channel: "zen", audience: "vip", retentionDays: null },
  { mediaType: "generated", channel: "wavespeed", audience: "non_vip", retentionDays: 7 },
  { mediaType: "generated", channel: "wavespeed", audience: "vip", retentionDays: null },
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
  channel: "zen" | "wavespeed",
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

export async function uploadMediaExpiry(createdAt = new Date()) {
  const retentionDays = await retentionDaysFor({
    mediaType: "upload",
    channel: "all",
    audience: "all",
  });
  return expiresAtFromDays(createdAt, retentionDays);
}

/**
 * 为上线该功能前创建、尚无到期字段的媒体补齐策略。
 * 旧数据没有“创建时 VIP”快照，因此仅在这次兼容补齐时以当前有效 VIP 状态推断。
 */
export async function backfillMissingMediaExpirations(): Promise<number> {
  await ensureMediaCleanupPolicies();
  const now = new Date();
  const [zenNonVipDays, waveNonVipDays, uploadDays] = await Promise.all([
    retentionDaysFor({ mediaType: "generated", channel: "zen", audience: "non_vip" }),
    retentionDaysFor({ mediaType: "generated", channel: "wavespeed", audience: "non_vip" }),
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
    db.waveSpeedGeneration.findMany({
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
          mediaExpiresAt: expiresAtFromDays(item.createdAt, vip ? null : zenNonVipDays),
        },
      });
    }),
    ...waveGenerations.map((item) => {
      const vip = item.ownerVipAtCreation || isCurrentVip(item.user);
      return db.waveSpeedGeneration.update({
        where: { id: item.id },
        data: {
          ownerVipAtCreation: vip,
          retentionAssigned: true,
          mediaExpiresAt: expiresAtFromDays(item.createdAt, vip ? null : waveNonVipDays),
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
    db.waveSpeedGeneration.findMany({
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
            policyMap.get(`generated:zen:${item.ownerVipAtCreation ? "vip" : "non_vip"}`) ?? null
          ),
        },
      })
    ),
    ...waveGenerations.map((item) =>
      db.waveSpeedGeneration.update({
        where: { id: item.id },
        data: {
          retentionAssigned: true,
          mediaExpiresAt: expiresAtFromDays(
            item.createdAt,
            policyMap.get(`generated:wavespeed:${item.ownerVipAtCreation ? "vip" : "non_vip"}`) ?? null
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
