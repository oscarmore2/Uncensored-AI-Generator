import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { draftSaveSchema } from "@/lib/validators";
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
  const parsed = draftSaveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const d = parsed.data;

  const draft = await db.draft.update({
    where: { id: existing.id },
    data: {
      mode: d.mode,
      tier: d.tier ?? existing.tier,
      spicy: d.spicy ?? existing.spicy,
      productId: d.product_id ?? null,
      providerModelId: d.provider_model_id ?? null,
      // title 只在显式带上时才动：自动回写不该把用户起的名字抹掉
      ...(d.title !== undefined ? { title: d.title } : {}),
      prompt: d.prompt ?? "",
      negativePrompt: d.negative_prompt ?? null,
      snapshot: d.snapshot ?? existing.snapshot,
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
