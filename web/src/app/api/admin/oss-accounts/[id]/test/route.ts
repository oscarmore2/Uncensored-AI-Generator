import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { ossConfigFromAccountId, testOssConnection } from "@/lib/oss";

/** 测试 OSS 桶连通性 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const accountId = Number(id);
  if (!Number.isInteger(accountId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    const config = await ossConfigFromAccountId(accountId);
    const result = await testOssConnection(config);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "连接测试失败" },
      { status: 502 }
    );
  }
}
