import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

/**
 * 草稿与任务单的对账（需求 8 的备案方案）。
 *
 * 主路径是生成成功那一刻就把草稿删掉。但那一步跑在浏览器里——用户关掉标签页、
 * 网络断掉、进程被杀，删除请求就发不出去，草稿会永远躺在列表里，
 * 而它对应的作品其实早就生成好了。
 *
 * 所以打开草稿列表时再对一次账：挂了任务单的草稿，去看那个任务跑完没，
 * 跑完了就删。
 *
 * 用 POST 不用 GET：这是会删数据的操作。挂在列表的 GET 上意味着预取、
 * 爬虫、甚至浏览器的推测性请求都会触发删除。
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const pending = await db.draft.findMany({
    where: { userId: user.id, generationId: { not: null } },
    select: { id: true, generationId: true },
  });
  if (!pending.length) return NextResponse.json({ removed: 0, unlinked: 0 });

  const genIds = [...new Set(pending.map((d) => d.generationId as number))];
  const gens = await db.generation.findMany({
    // 带上 userId：任务单是客户端写进来的，不能拿它去读别人的任务状态
    where: { id: { in: genIds }, userId: user.id },
    select: { id: true, status: true },
  });
  const statusById = new Map(gens.map((g) => [g.id, g.status]));

  const doneIds: number[] = [];
  const orphanIds: number[] = [];
  for (const d of pending) {
    const status = statusById.get(d.generationId as number);
    if (status === undefined) {
      // 任务查不到（记录被清掉，或压根不是这个用户的）。
      // 确认不了「已成功」就不能删——宁可留着让用户自己处理，
      // 只把任务单解绑，让它重新成为可继续编辑的活动草稿。
      orphanIds.push(d.id);
    } else if (status === "succeeded" || status === "partial") {
      doneIds.push(d.id);
    }
    // 失败 / 还在跑：留着。失败正是用户要改了重试的场景。
  }

  if (doneIds.length) {
    await db.draft.deleteMany({ where: { id: { in: doneIds }, userId: user.id } });
  }
  if (orphanIds.length) {
    await db.draft.updateMany({
      where: { id: { in: orphanIds }, userId: user.id },
      data: { generationId: null },
    });
  }

  return NextResponse.json({ removed: doneIds.length, unlinked: orphanIds.length });
}
