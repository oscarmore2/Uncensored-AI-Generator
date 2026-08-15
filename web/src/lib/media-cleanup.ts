import "server-only";
import { MEDIA_DELETE_REASONS } from "./media-delete-reason";
import { markMediaAssetDeletedCompat } from "./media-asset-compat";
import { db } from "./db";
import { deleteManagedMediaUrl, deleteObjectKey } from "./oss";
import { objectStillReferenced } from "./media-dedup";
import { backfillMissingMediaExpirations, ensureMediaCleanupPolicies } from "./media-retention";

function parseUrls(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function scrubUrl(value: unknown, target: string): unknown {
  if (value === target) return null;
  if (Array.isArray(value)) {
    return value.map((item) => scrubUrl(item, target)).filter((item) => item !== null);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, scrubUrl(item, target)])
    );
  }
  return value;
}

export type CleanupResult = {
  runId: number;
  dryRun: boolean;
  scanned: number;
  deleted: number;
  failed: number;
  uploads: number;
  mainGenerations: number;
  playthingGenerations: number;
};

export async function runMediaCleanup(opts?: {
  dryRun?: boolean;
  limit?: number;
  now?: Date;
}): Promise<CleanupResult> {
  await ensureMediaCleanupPolicies();
  await backfillMissingMediaExpirations();
  const dryRun = Boolean(opts?.dryRun);
  const requestedLimit = opts?.limit ?? 100;
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(500, Math.max(1, Math.trunc(requestedLimit)))
    : 100;
  const now = opts?.now ?? new Date();
  const run = await db.mediaCleanupRun.create({ data: { dryRun } });

  let scanned = 0;
  let deleted = 0;
  let failed = 0;
  let uploadsDeleted = 0;
  let mainDeleted = 0;
  let waveDeleted = 0;
  const errors: Array<{ type: string; id: number; error: string }> = [];

  try {
    const [uploads, generations, waveGenerations] = await Promise.all([
      db.mediaAsset.findMany({
        where: { expiresAt: { lte: now }, deletedAt: null },
        orderBy: { expiresAt: "asc" },
        take: limit,
      }),
      db.generation.findMany({
        where: {
          mediaExpiresAt: { lte: now },
          mediaDeletedAt: null,
          visibility: { not: "featured" },
          status: { in: ["succeeded", "failed"] },
        },
        orderBy: { mediaExpiresAt: "asc" },
        take: limit,
      }),
      db.playthingGeneration.findMany({
        where: {
          mediaExpiresAt: { lte: now },
          mediaDeletedAt: null,
          status: { in: ["succeeded", "failed"] },
        },
        orderBy: { mediaExpiresAt: "asc" },
        take: limit,
      }),
    ]);

    scanned = uploads.length + generations.length + waveGenerations.length;

    for (const asset of uploads) {
      if (dryRun) {
        uploadsDeleted++;
        deleted++;
        continue;
      }
      try {
        /*
         * 去重之后一个对象可能被多条记录共用，物理删除前必须数一下引用。
         * 少了这一步，A 的上传物到期被清理会把 B 正在用的同一个文件一起删掉。
         * 这条记录本身照常标记删除，只是不动 OSS 上的对象。
         */
        if (asset.objectKey) {
          if (!(await objectStillReferenced(asset.objectKey, asset.id))) {
            await deleteObjectKey(asset.objectKey);
          }
        } else {
          await deleteManagedMediaUrl(asset.url);
        }
        // 缺列时退化成只写删除时间，别让整个清理任务卡在一条记录上
        await markMediaAssetDeletedCompat(asset.id, {
          deletedAt: now,
          deleteReason: MEDIA_DELETE_REASONS.RETENTION_EXPIRED,
          deleteAttempts: { increment: 1 },
          lastError: null,
        });
        if (asset.sourceId) {
          const generation = await db.playthingGeneration.findUnique({
            where: { id: asset.sourceId },
            select: { params: true },
          });
          if (generation) {
            let params: unknown = {};
            try {
              params = JSON.parse(generation.params);
            } catch {
              params = {};
            }
            await db.playthingGeneration.update({
              where: { id: asset.sourceId },
              data: { params: JSON.stringify(scrubUrl(params, asset.url)) },
            });
          }
        }
        uploadsDeleted++;
        deleted++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await db.mediaAsset.update({
          where: { id: asset.id },
          data: {
            deleteAttempts: { increment: 1 },
            lastError: message.slice(0, 500),
          },
        });
        failed++;
        errors.push({ type: "upload", id: asset.id, error: message.slice(0, 200) });
      }
    }

    for (const generation of generations) {
      if (dryRun) {
        mainDeleted++;
        deleted++;
        continue;
      }
      try {
        for (const url of parseUrls(generation.resultUrls)) {
          await deleteManagedMediaUrl(url);
        }
        await db.generation.update({
          where: { id: generation.id },
          data: { resultUrls: null, mediaDeletedAt: now },
        });
        mainDeleted++;
        deleted++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failed++;
        errors.push({ type: "main", id: generation.id, error: message.slice(0, 200) });
      }
    }

    for (const generation of waveGenerations) {
      if (dryRun) {
        waveDeleted++;
        deleted++;
        continue;
      }
      try {
        for (const url of parseUrls(generation.resultUrls)) {
          await deleteManagedMediaUrl(url);
        }
        await db.playthingGeneration.update({
          where: { id: generation.id },
          data: { resultUrls: null, mediaDeletedAt: now },
        });
        waveDeleted++;
        deleted++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failed++;
        errors.push({ type: "plaything", id: generation.id, error: message.slice(0, 200) });
      }
    }

    const result: CleanupResult = {
      runId: run.id,
      dryRun,
      scanned,
      deleted,
      failed,
      uploads: uploadsDeleted,
      mainGenerations: mainDeleted,
      playthingGenerations: waveDeleted,
    };
    await db.mediaCleanupRun.update({
      where: { id: run.id },
      data: {
        status: failed > 0 ? "partial" : "succeeded",
        scanned,
        deleted,
        failed,
        detail: JSON.stringify({ ...result, errors }),
        completedAt: new Date(),
      },
    });
    return result;
  } catch (error) {
    await db.mediaCleanupRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        scanned,
        deleted,
        failed: failed + 1,
        detail: JSON.stringify({ error: error instanceof Error ? error.message : String(error), errors }),
        completedAt: new Date(),
      },
    });
    throw error;
  }
}
