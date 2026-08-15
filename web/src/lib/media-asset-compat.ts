import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "./db";

/**
 * 建 / 改 MediaAsset 时对「库还没迁移」保持容错。
 *
 * filename、deleteReason、sha256 都是后加的列，纯记账用途。库若还没跑 db push，
 * 带上它们的写入会抛 P2022，结果是**参考图传不上去、整个生成用不了**——
 * 为两个可有可无的字段赔上主流程，不划算。
 *
 * 注意不能简单地「去掉新字段重试一次」：Prisma 的 create/update 会把模型
 * 声明的所有列放进 RETURNING，即使不写 filename，读回时照样撞上缺列。
 * 所以降级分支只能走裸 SQL，绕开 Prisma 的列映射。
 *
 * 记录必须建出来，不能跳过——否则清理任务扫不到这个文件，
 * OSS 里就多一个永不回收的孤儿。少的只是文件名，保留期与回收都不受影响。
 */

const MISSING_COLUMN = "P2022";

function isMissingColumn(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) return err.code === MISSING_COLUMN;
  return err instanceof Error && /column .* does not exist/i.test(err.message);
}

type MediaAssetCreate = Prisma.MediaAssetUncheckedCreateInput;

export async function createMediaAssetCompat(
  data: MediaAssetCreate
): Promise<{ id: number; url: string; degraded: boolean }> {
  try {
    const asset = await db.mediaAsset.create({ data });
    return { id: asset.id, url: asset.url, degraded: false };
  } catch (err) {
    if (!isMissingColumn(err)) throw err;

    console.warn(
      "[media-asset] 数据库缺少 filename/deleteReason 列，已降级写入（请尽快执行 prisma db push）"
    );
    const rows = await db.$queryRaw<Array<{ id: number }>>`
      INSERT INTO "MediaAsset"
        ("userId", "kind", "channel", "url", "objectKey", "contentType", "bytes",
         "sourceId", "retentionAssigned", "expiresAt", "createdAt", "updatedAt")
      VALUES (
        ${data.userId}, ${data.kind}, ${data.channel}, ${data.url},
        ${data.objectKey ?? null}, ${data.contentType ?? null}, ${data.bytes ?? null},
        ${data.sourceId ?? null}, ${data.retentionAssigned ?? false},
        ${data.expiresAt ? new Date(data.expiresAt as string | Date) : null},
        now(), now()
      )
      RETURNING id`;
    return { id: rows[0].id, url: data.url, degraded: true };
  }
}

/** 标记删除时同样可能撞上缺列，降级成不写删除原因 */
export async function markMediaAssetDeletedCompat(
  id: number,
  data: {
    deletedAt: Date;
    deleteReason: string;
    deleteAttempts: { increment: number };
    lastError: null;
  }
): Promise<void> {
  try {
    await db.mediaAsset.update({ where: { id }, data });
  } catch (err) {
    if (!isMissingColumn(err)) throw err;
    await db.$executeRaw`
      UPDATE "MediaAsset"
         SET "deletedAt" = ${data.deletedAt},
             "deleteAttempts" = "deleteAttempts" + ${data.deleteAttempts.increment},
             "lastError" = NULL,
             "updatedAt" = now()
       WHERE id = ${id}`;
  }
}
