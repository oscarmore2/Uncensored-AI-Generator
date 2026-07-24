import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { runMediaCleanup } from "@/lib/media-cleanup";
import {
  DEFAULT_MEDIA_POLICIES,
  ensureMediaCleanupPolicies,
  recalculateMediaExpirations,
} from "@/lib/media-retention";

const validKeys = new Set(
  DEFAULT_MEDIA_POLICIES.map(
    (item) => `${item.mediaType}:${item.channel}:${item.audience}`
  )
);

async function requireAdmin() {
  return requireRole("admin");
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await ensureMediaCleanupPolicies();
  const [policies, runs, pendingUploads, pendingZen, pendingWave] = await Promise.all([
    db.mediaCleanupPolicy.findMany({ orderBy: { id: "asc" } }),
    db.mediaCleanupRun.findMany({ orderBy: { startedAt: "desc" }, take: 20 }),
    db.mediaAsset.count({ where: { expiresAt: { not: null }, deletedAt: null } }),
    db.generation.count({
      where: {
        mediaExpiresAt: { not: null },
        mediaDeletedAt: null,
        visibility: { not: "featured" },
      },
    }),
    db.waveSpeedGeneration.count({
      where: { mediaExpiresAt: { not: null }, mediaDeletedAt: null },
    }),
  ]);

  return NextResponse.json({
    policies: policies.map((item) => ({
      id: item.id,
      media_type: item.mediaType,
      channel: item.channel,
      audience: item.audience,
      retention_days: item.retentionDays,
      updated_at: item.updatedAt.toISOString(),
    })),
    pending: {
      uploads: pendingUploads,
      zen_generations: pendingZen,
      wavespeed_generations: pendingWave,
    },
    runs: runs.map((run) => ({
      id: run.id,
      dry_run: run.dryRun,
      status: run.status,
      scanned: run.scanned,
      deleted: run.deleted,
      failed: run.failed,
      started_at: run.startedAt.toISOString(),
      completed_at: run.completedAt?.toISOString() ?? null,
    })),
  });
}

export async function PATCH(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as
    | {
        policies?: Array<{
          media_type?: string;
          channel?: string;
          audience?: string;
          retention_days?: number | null;
        }>;
      }
    | null;
  if (!body?.policies?.length) {
    return NextResponse.json({ error: "请提交至少一条策略" }, { status: 400 });
  }

  for (const item of body.policies) {
    const key = `${item.media_type}:${item.channel}:${item.audience}`;
    if (!validKeys.has(key)) {
      return NextResponse.json({ error: `不支持的策略：${key}` }, { status: 400 });
    }
    if (
      item.retention_days !== null &&
      (!Number.isInteger(item.retention_days) ||
        item.retention_days === undefined ||
        item.retention_days < 1 ||
        item.retention_days > 3650)
    ) {
      return NextResponse.json({ error: "保留天数须为 1–3650 的整数，或设为永不过期" }, { status: 400 });
    }
  }

  await ensureMediaCleanupPolicies();
  await db.$transaction(
    body.policies.map((item) =>
      db.mediaCleanupPolicy.update({
        where: {
          mediaType_channel_audience: {
            mediaType: item.media_type!,
            channel: item.channel!,
            audience: item.audience!,
          },
        },
        data: { retentionDays: item.retention_days! },
      })
    )
  );
  const recalculated = await recalculateMediaExpirations();
  return NextResponse.json({ ok: true, recalculated });
}

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as {
    dry_run?: boolean;
    limit?: number;
  };
  const result = await runMediaCleanup({
    dryRun: body.dry_run !== false,
    limit: Number.isInteger(body.limit) ? body.limit : undefined,
  });
  return NextResponse.json(result);
}
