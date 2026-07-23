import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { decryptSecret } from "@/lib/secret-crypto";
import { testHfToken } from "@/lib/hf";

/** 测试指定 HF 账户连通性 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const accountId = Number(id);
  if (!Number.isInteger(accountId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const account = await db.hfAccount.findUnique({ where: { id: accountId } });
  if (!account) return NextResponse.json({ error: "账户不存在" }, { status: 404 });

  try {
    const token = decryptSecret(account.apiTokenEnc);
    await testHfToken(token, {
      baseUrl: account.baseUrl ?? undefined,
      magicModel: account.magicModel ?? undefined,
    });
    return NextResponse.json({ ok: true, message: "连通正常" });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "测试失败" },
      { status: 400 }
    );
  }
}
