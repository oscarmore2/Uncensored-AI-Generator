import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { hasPlaythingAccess } from "@/lib/plaything-access";
import { playthingGenerationOut, playthingProductInclude } from "@/lib/plaything-serialize";

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
    include: { product: { select: playthingProductInclude } },
  });
  if (!g) return NextResponse.json({ error: "任务不存在" }, { status: 404 });

  return NextResponse.json(playthingGenerationOut(g));
}
