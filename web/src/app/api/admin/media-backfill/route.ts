import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { runMediaBackfill } from "@/lib/media-backfill";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * 管理端触发媒体补录。
 *
 * 与 /api/internal/media-backfill 是同一份逻辑的两个入口：
 * internal 那条给脚本/定时任务用，靠 MEDIA_CLEANUP_SECRET；这条给人用，
 * 走管理员登录。一次性运维操作不该逼着人先去翻环境变量。
 */
export async function POST(req: Request) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { dry_run?: boolean; limit?: number };
  try {
    const result = await runMediaBackfill({
      // 默认只体检；要写库必须显式传 false
      dryRun: body.dry_run !== false,
      limit: Number.isInteger(body.limit) ? body.limit : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "补录失败" },
      { status: 500 }
    );
  }
}
