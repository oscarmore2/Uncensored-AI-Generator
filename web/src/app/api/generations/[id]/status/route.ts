import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const genId = Number(id);
  if (!Number.isInteger(genId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const gen = await db.generation.findFirst({ where: { id: genId, userId: user.id } });
  if (!gen) return NextResponse.json({ error: "Generation not found" }, { status: 404 });

  return NextResponse.json({
    id: gen.id,
    status: gen.status,
    progress: gen.progress,
    zen_job_id: gen.zenJobId,
    error: gen.zenError,
    result_urls: gen.resultUrls ? (JSON.parse(gen.resultUrls) as string[]) : null,
    is_adult: gen.isAdult,
    media_expires_at: gen.mediaExpiresAt,
    media_deleted_at: gen.mediaDeletedAt,
  });
}
