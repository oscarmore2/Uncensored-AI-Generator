import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/csrf";
import { decryptSecret } from "@/lib/secret-crypto";
import { testNowPaymentsCredentials } from "@/lib/nowpayments";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const origin = assertSameOrigin(req);
  if (!origin.ok) {
    return NextResponse.json({ error: origin.error }, { status: origin.status });
  }
  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const account = await db.nowPaymentsAccount.findUnique({ where: { id } });
  if (!account) return NextResponse.json({ error: "配置不存在" }, { status: 404 });
  try {
    await testNowPaymentsCredentials({
      apiKey: decryptSecret(account.apiKeyEnc),
      ipnSecret: decryptSecret(account.ipnSecretEnc),
      baseUrl: account.baseUrl,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[nowpayments] configuration test failed", error);
    return NextResponse.json(
      { error: "NOWPayments API 测试失败，请检查 API Key、Base URL 或后台白名单" },
      { status: 502 }
    );
  }
}
