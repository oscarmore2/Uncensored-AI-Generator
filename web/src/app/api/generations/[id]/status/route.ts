import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { recheckOne } from "@/lib/generation-recheck";
import { OPEN_STATUSES } from "@/lib/generation-settle";

/**
 * 同一条记录多久之内不重复问上游。
 *
 * 创作页会一直轮这个接口。任务一旦转成超时，不节流的话每轮都会打一次上游。
 * 重查本身会更新这一行（哪怕结论还是超时），所以拿 updatedAt 当节流窗口是准的。
 */
const RECHECK_THROTTLE_MS = 20_000;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const genId = Number(id);
  if (!Number.isInteger(genId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  let gen = await db.generation.findFirst({ where: { id: genId, userId: user.id } });
  if (!gen) return NextResponse.json({ error: "Generation not found" }, { status: 404 });

  /*
   * 还没有终局就顺手回上游确认一次。创作页正盯着这个接口看，
   * 在这里确认比等用户切到历史记录再确认要及时得多。
   */
  if (
    (OPEN_STATUSES as readonly string[]).includes(gen.status) &&
    gen.providerJobId &&
    Date.now() - gen.updatedAt.getTime() > RECHECK_THROTTLE_MS
  ) {
    const settled = await recheckOne(gen).catch(() => false);
    if (settled) {
      gen = (await db.generation.findFirst({ where: { id: genId, userId: user.id } })) ?? gen;
    }
  }

  return NextResponse.json({
    id: gen.id,
    status: gen.status,
    progress: gen.progress,
    job_id: gen.providerJobId,
    error: gen.providerError,
    result_urls: gen.resultUrls ? (JSON.parse(gen.resultUrls) as string[]) : null,
    is_adult: gen.isAdult,
    media_expires_at: gen.mediaExpiresAt,
    media_deleted_at: gen.mediaDeletedAt,
  });
}
