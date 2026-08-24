import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAdminAction } from "@/lib/admin-audit";
import { llmAccountOut } from "@/lib/llm/account-serialize";

const patchSchema = z.object({
  label: z.string().min(1).max(80).optional(),
  base_url: z.string().url().max(300).nullable().optional(),
  activate: z.boolean().optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "参数无效" }, { status: 400 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, { status: 400 });
  }
  const data = parsed.data;

  const account = await db.$transaction(async (tx) => {
    // 同一时间只有一个账户生效，与 HfAccount / OpenAiAccount 同一条规矩
    if (data.activate) {
      await tx.llmAccount.updateMany({ where: { isActive: true }, data: { isActive: false } });
    }
    return tx.llmAccount.update({
      where: { id },
      data: {
        ...(data.label !== undefined ? { label: data.label } : {}),
        ...(data.base_url !== undefined ? { baseUrl: data.base_url?.trim() || null } : {}),
        ...(data.activate !== undefined ? { isActive: data.activate } : {}),
      },
    });
  });

  await logAdminAction(admin.id, "llm_account", { type: "llm_account", id }, { op: "update", ...data });
  return NextResponse.json({ ok: true, account: llmAccountOut(account) });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "参数无效" }, { status: 400 });

  await db.llmAccount.delete({ where: { id } });
  await logAdminAction(admin.id, "llm_account", { type: "llm_account", id }, { op: "delete" });
  return NextResponse.json({ ok: true });
}
