import "server-only";
import { db } from "./db";
import { deleteManagedMediaUrl, deleteObjectKey } from "./oss";
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
  zenGenerations: number;
  waveSpeedGenerations: number;
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
  let zenDeleted = 0;
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
      db.waveSpeedGeneration.findMany({
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
        if (asset.objectKey) await deleteObjectKey(asset.objectKey);
        else await deleteManagedMediaUrl(asset.url);
        await db.mediaAsset.update({
          where: { id: asset.id },
          data: {
            deletedAt: now,
            deleteAttempts: { increment: 1 },
            lastError: null,
          },
        });
        if (asset.sourceId) {
          const generation = await db.waveSpeedGeneration.findUnique({
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
            await db.waveSpeedGeneration.update({
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
        zenDeleted++;
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
        zenDeleted++;
        deleted++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failed++;
        errors.push({ type: "zen", id: generation.id, error: message.slice(0, 200) });
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
        await db.waveSpeedGeneration.update({
          where: { id: generation.id },
          data: { resultUrls: null, mediaDeletedAt: now },
        });
        waveDeleted++;
        deleted++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failed++;
        errors.push({ type: "wavespeed", id: generation.id, error: message.slice(0, 200) });
      }
    }

    const result: CleanupResult = {
      runId: run.id,
      dryRun,
      scanned,
      deleted,
      failed,
      uploads: uploadsDeleted,
      zenGenerations: zenDeleted,
      waveSpeedGenerations: waveDeleted,
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
