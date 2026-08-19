import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { draftCreateSchema } from "@/lib/validators";
import { draftOut } from "@/lib/serialize";
import { rateLimit } from "@/lib/rate-limit";
import { isVipActive } from "@/lib/pricing";

/**
 * 草稿列表 / 活动草稿 / 新建。
 *
 * 「活动草稿」= 该模式下最近一条**还没提交过生成**的草稿。
 * 不给 (userId, mode) 加唯一约束，因为草稿提交后会挂上 generationId、
 * 在确认删除之前仍然留着；那之后用户在同一模式里的新编辑应该是一条新草稿，
 * 唯一约束会把这两件事挤在一起。
 */

/** 一个用户最多留多少条草稿。防的是脚本刷，不是正常使用。 */
const MAX_DRAFTS_PER_USER = 200;

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const mode = url.searchParams.get("mode");

  if (url.searchParams.get("active") === "1") {
    if (!mode) return NextResponse.json({ error: "缺少 mode" }, { status: 400 });
    const draft = await db.draft.findFirst({
      where: { userId: user.id, mode, generationId: null },
      orderBy: { updatedAt: "desc" },
    });
    return NextResponse.json({ draft: draft ? draftOut(draft) : null });
  }

  const drafts = await db.draft.findMany({
    where: { userId: user.id, ...(mode ? { mode } : {}) },
    orderBy: { updatedAt: "desc" },
    take: MAX_DRAFTS_PER_USER,
  });
  return NextResponse.json(drafts.map(draftOut));
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // 自动回写是防抖触发的，正常节奏远低于这个上限；超了多半是出了循环
  if (!rateLimit(`draft:${user.id}`, 120, 60_000)) {
    return NextResponse.json({ error: "保存过于频繁" }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = draftCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const d = parsed.data;

  /*
   * 「另存为」是 VIP 功能。不能只靠前端藏按钮——接口是公开的，
   * 前端的判断只是不给入口，真正的门在这里。
   */
  if (d.save_as && !isVipActive(user)) {
    return NextResponse.json({ error: "另存为草稿仅对 VIP 开放" }, { status: 403 });
  }

  const count = await db.draft.count({ where: { userId: user.id } });
  if (count >= MAX_DRAFTS_PER_USER) {
    return NextResponse.json(
      { error: `草稿数量已达上限（${MAX_DRAFTS_PER_USER}），请先删除一些` },
      { status: 400 }
    );
  }

  const draft = await db.draft.create({
    data: {
      userId: user.id,
      mode: d.mode,
      tier: d.tier ?? "low",
      spicy: d.spicy ?? false,
      productId: d.product_id ?? null,
      providerModelId: d.provider_model_id ?? null,
      title: d.title ?? null,
      prompt: d.prompt ?? "",
      negativePrompt: d.negative_prompt ?? null,
      snapshot: d.snapshot ?? "{}",
    },
  });
  return NextResponse.json(draftOut(draft), { status: 201 });
}
