import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { decryptSecret } from "@/lib/secret-crypto";
import { testOpenAiKey } from "@/lib/openai";

/** 用已保存的 Key 打一次 moderations（免费端点），验证是否可用 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const account = await db.openAiAccount.findUnique({ where: { id } });
  if (!account) return NextResponse.json({ error: "账户不存在" }, { status: 404 });

  try {
    await testOpenAiKey(decryptSecret(account.apiKeyEnc), {
      baseUrl: account.baseUrl ?? undefined,
      moderationModel: account.moderationModel ?? undefined,
    });
    return NextResponse.json({ ok: true, message: "连接正常" });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "连接失败" },
      { status: 400 }
    );
  }
}
