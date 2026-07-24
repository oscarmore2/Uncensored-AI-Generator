import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { runMediaCleanup } from "@/lib/media-cleanup";

export const runtime = "nodejs";
export const maxDuration = 60;

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

  const body = await req.json().catch(() => ({})) as { dry_run?: boolean; limit?: number };
  const result = await runMediaCleanup({
    dryRun: Boolean(body.dry_run),
    limit: body.limit,
  });
  return NextResponse.json(result);
}
