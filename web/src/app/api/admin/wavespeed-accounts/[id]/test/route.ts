import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { decryptSecret } from "@/lib/secret-crypto";
import { testWaveSpeedKey } from "@/lib/wavespeed";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const accountId = Number((await ctx.params).id);
  if (!Number.isInteger(accountId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const existing = await db.waveSpeedAccount.findUnique({ where: { id: accountId } });
  if (!existing) return NextResponse.json({ error: "账户不存在" }, { status: 404 });

  try {
    await testWaveSpeedKey(decryptSecret(existing.apiKeyEnc));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
