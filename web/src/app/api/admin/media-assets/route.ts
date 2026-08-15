import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * 上传台账 + 去重成效。
 *
 * 「省了多少」= 引用总字节 − 实际占用字节。
 * 实际占用按不同的 objectKey 各算一次：去重之后多条记录共用一个对象，
 * 把 bytes 直接加起来会把同一份文件重复计进去，看着像存了 10 份。
 */
export async function GET(req: Request) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const params = new URL(req.url).searchParams;
  const take = Math.min(Math.max(Number(params.get("limit") ?? 50), 1), 200);
  const q = (params.get("q") ?? "").trim();
  const onlyDup = params.get("dup") === "1";

  const where = {
    kind: "upload",
    ...(q
      ? {
          OR: [
            { filename: { contains: q, mode: "insensitive" as const } },
            { sha256: { startsWith: q.toLowerCase() } },
          ],
        }
      : {}),
  };

  const [rows, liveAssets, distinctObjects] = await Promise.all([
    db.mediaAsset.findMany({
      where,
      orderBy: { id: "desc" },
      take,
      select: {
        id: true, userId: true, channel: true, filename: true, contentType: true,
        bytes: true, sha256: true, objectKey: true, url: true,
        createdAt: true, expiresAt: true, deletedAt: true, deleteReason: true,
      },
    }),
    db.mediaAsset.findMany({
      where: { kind: "upload", deletedAt: null },
      select: { bytes: true, objectKey: true },
    }),
    // 存活记录里有多少个互不相同的对象
    db.mediaAsset.groupBy({
      by: ["objectKey"],
      where: { kind: "upload", deletedAt: null, objectKey: { not: null } },
      _count: { _all: true },
      _max: { bytes: true },
    }),
  ]);

  const referencedBytes = liveAssets.reduce((n, a) => n + (a.bytes ?? 0), 0);
  const storedBytes = distinctObjects.reduce((n, g) => n + (g._max.bytes ?? 0), 0);
  // 被复用超过一次的对象数量：这就是去重真正起作用的地方
  const sharedObjects = distinctObjects.filter((g) => g._count._all > 1).length;

  // 每条记录对应的对象被几条记录共用，列表里直接标出来
  const refCount = new Map(distinctObjects.map((g) => [g.objectKey, g._count._all]));

  const items = rows
    .filter((r) => (onlyDup ? (refCount.get(r.objectKey) ?? 0) > 1 : true))
    .map((r) => ({
      id: r.id,
      user_id: r.userId,
      channel: r.channel,
      filename: r.filename,
      content_type: r.contentType,
      bytes: r.bytes,
      sha256: r.sha256,
      sha256_short: r.sha256 ? r.sha256.slice(0, 12) : null,
      url: r.url,
      refs: r.objectKey ? (refCount.get(r.objectKey) ?? 1) : 1,
      created_at: r.createdAt,
      expires_at: r.expiresAt,
      deleted_at: r.deletedAt,
      delete_reason: r.deleteReason,
    }));

  return NextResponse.json({
    items,
    stats: {
      live_assets: liveAssets.length,
      distinct_objects: distinctObjects.length,
      shared_objects: sharedObjects,
      referenced_bytes: referencedBytes,
      stored_bytes: storedBytes,
      saved_bytes: Math.max(referencedBytes - storedBytes, 0),
      // 老数据没有哈希，不参与去重；这个数字提示还有多少历史记录没被覆盖
      without_hash: liveAssets.length - (await db.mediaAsset.count({
        where: { kind: "upload", deletedAt: null, sha256: { not: null } },
      })),
    },
  });
}
