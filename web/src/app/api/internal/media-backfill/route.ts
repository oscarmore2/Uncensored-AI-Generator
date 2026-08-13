import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { runMediaBackfill } from "@/lib/media-backfill";

export const runtime = "nodejs";
export const maxDuration = 300;

/** 与 media-cleanup 同一把内部密钥，不再多开一个配置项 */
function authorized(req: Request): boolean {
  if (!env.MEDIA_CLEANUP_SECRET) return false;
  const supplied = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const expected = env.MEDIA_CLEANUP_SECRET;
  if (supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

export async function POST(req: Request) {
  if (!env.MEDIA_CLEANUP_SECRET) {
    return NextResponse.json({ error: "MEDIA_CLEANUP_SECRET is not configured" }, { status: 503 });
  }
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { dry_run?: boolean; limit?: number };
  try {
    const result = await runMediaBackfill({
      dryRun: body.dry_run !== false, // 默认只体检，要写库必须显式传 dry_run: false
      limit: body.limit,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "补录失败" },
      { status: 500 }
    );
  }
}
