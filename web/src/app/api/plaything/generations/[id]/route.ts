import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { hasPlaythingAccess } from "@/lib/plaything-access";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPlaythingAccess(user)) {
    return NextResponse.json({ error: "无玩物专区访问权限" }, { status: 403 });
  }

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const g = await db.waveSpeedGeneration.findFirst({
    where: { id, userId: user.id },
    include: { product: { select: { label: true, modelId: true } } },
  });
  if (!g) return NextResponse.json({ error: "任务不存在" }, { status: 404 });

  return NextResponse.json({
    id: g.id,
    product_id: g.productId,
    product_label: g.product.label,
    model_id: g.product.modelId,
    prompt: g.prompt,
    status: g.status,
    progress: g.progress,
    result_urls: g.resultUrls ? (JSON.parse(g.resultUrls) as string[]) : null,
    cost: g.cost,
    error: g.error,
    created_at: g.createdAt,
  });
}
