import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { draftPatchSchema } from "@/lib/validators";
import { draftOut } from "@/lib/serialize";
import { rateLimit } from "@/lib/rate-limit";

/** 单条草稿的读 / 改 / 删。一律带 userId 过滤，不靠 id 猜不到来做隔离。 */

async function ownedDraft(userId: number, raw: string) {
  const id = Number(raw);
  if (!Number.isInteger(id)) return null;
  return db.draft.findFirst({ where: { id, userId } });
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const draft = await ownedDraft(user.id, (await ctx.params).id);
  if (!draft) return NextResponse.json({ error: "草稿不存在" }, { status: 404 });
  return NextResponse.json(draftOut(draft));
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!rateLimit(`draft:${user.id}`, 120, 60_000)) {
    return NextResponse.json({ error: "保存过于频繁" }, { status: 429 });
  }

  const existing = await ownedDraft(user.id, (await ctx.params).id);
  if (!existing) return NextResponse.json({ error: "草稿不存在" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = draftPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const d = parsed.data;

  const draft = await db.draft.update({
    where: { id: existing.id },
    data: {
      /*
       * 真正的部分更新：只动显式带上来的字段。
       *
       * PATCH 的调用方不止一个——自动回写只带表单内容，挂任务单只带
       * generation_id，改名只带 title。任何一个字段若无条件覆盖，
       * 别的调用方写的东西就会被抹掉：挂完任务单下一次自动回写把它清了，
       * 对账就再也找不到这条草稿对应哪个任务；反过来挂任务单时也会
       * 把用户刚写的提示词冲掉。
       */
      ...(d.mode !== undefined ? { mode: d.mode } : {}),
      ...(d.tier !== undefined ? { tier: d.tier } : {}),
      ...(d.spicy !== undefined ? { spicy: d.spicy } : {}),
      ...(d.product_id !== undefined ? { productId: d.product_id } : {}),
      ...(d.provider_model_id !== undefined ? { providerModelId: d.provider_model_id } : {}),
      ...(d.title !== undefined ? { title: d.title } : {}),
      ...(d.generation_id !== undefined ? { generationId: d.generation_id } : {}),
      ...(d.prompt !== undefined ? { prompt: d.prompt } : {}),
      ...(d.negative_prompt !== undefined ? { negativePrompt: d.negative_prompt } : {}),
      ...(d.snapshot !== undefined ? { snapshot: d.snapshot } : {}),
    },
  });
  return NextResponse.json(draftOut(draft));
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const draft = await ownedDraft(user.id, (await ctx.params).id);
  if (!draft) return NextResponse.json({ error: "草稿不存在" }, { status: 404 });

  await db.draft.delete({ where: { id: draft.id } });
  return NextResponse.json({ ok: true });
}
