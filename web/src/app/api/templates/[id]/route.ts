import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { templatePatchSchema } from "@/lib/validators";

/** 模板改名 / 删除 / 记一次使用。一律带 userId 过滤。 */

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "参数无效" }, { status: 400 });

  const body = await req.json().catch(() => null);
  // 只带 used=true 就是「记一次套用」，不改名
  if (body && typeof body === "object" && (body as { used?: unknown }).used === true) {
    const updated = await db.promptTemplate.updateMany({
      where: { id, userId: user.id },
      data: { useCount: { increment: 1 } },
    });
    if (!updated.count) return NextResponse.json({ error: "模板不存在" }, { status: 404 });
    return NextResponse.json({ ok: true });
  }

  const parsed = templatePatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const updated = await db.promptTemplate.updateMany({
    where: { id, userId: user.id },
    data: { name: parsed.data.name },
  });
  if (!updated.count) return NextResponse.json({ error: "模板不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "参数无效" }, { status: 400 });

  const deleted = await db.promptTemplate.deleteMany({ where: { id, userId: user.id } });
  if (!deleted.count) return NextResponse.json({ error: "模板不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
