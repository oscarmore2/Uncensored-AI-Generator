import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { generationModOut } from "@/lib/serialize";

/** 审核队列：支持 status/mode/user_id/是否含已删 筛选，分页 */
export async function GET(req: Request) {
  const mod = await requireRole("moderator", "admin");
  if (!mod) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 30));
  const status = url.searchParams.get("status");
  const mode = url.searchParams.get("mode");
  const userId = Number(url.searchParams.get("user_id")) || null;
  const includeDeleted = url.searchParams.get("include_deleted") === "1";

  const where = {
    ...(status ? { status } : {}),
    ...(mode ? { mode } : {}),
    ...(userId ? { userId } : {}),
    ...(includeDeleted ? {} : { deletedAt: null }),
  };

  const [total, gens] = await Promise.all([
    db.generation.count({ where }),
    db.generation.findMany({
      where,
      include: { user: { select: { username: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return NextResponse.json({
    total,
    page,
    limit,
    generations: gens.map(generationModOut),
  });
}
