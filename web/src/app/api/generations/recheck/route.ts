import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { recheckUserGenerations } from "@/lib/generation-recheck";

/**
 * 回上游确认那些还没有终局的任务。
 *
 * 由「打开历史记录」触发。**不放进列表接口里**：列表要快，而这一步要打几个
 * 上游请求；混在一起的话，一个上游变慢就让整页转圈。分开之后前端可以先把
 * 列表画出来，确认完再刷新那几条。
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // 打开一次历史记录问一轮就够了，不该被连点放大成对上游的连续请求
  if (!rateLimit(`gen-recheck:${user.id}`, 6, 60_000)) {
    return NextResponse.json({ checked: 0, settled: 0 });
  }

  const outcome = await recheckUserGenerations(user.id);
  return NextResponse.json(outcome);
}
