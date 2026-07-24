import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { publicWorkOut } from "@/lib/serialize";
import { getCurrentUser } from "@/lib/auth";
import { hasAdultAccess } from "@/lib/adult-access";

/** 游客可访问的公共作品详情 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const workId = Number(id);
  if (!Number.isInteger(workId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const user = await getCurrentUser();
  const adultAccess = hasAdultAccess(user);
  const work = await db.publicWork.findFirst({
    where: {
      id: workId,
      isPublished: true,
      ...(!adultAccess ? { isAdult: false } : {}),
    },
  });
  if (!work) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(publicWorkOut(work));
}
