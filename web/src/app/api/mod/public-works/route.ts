import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { publicWorkModOut } from "@/lib/serialize";

/** 公共库管理列表（含未上架），分页 */
export async function GET(req: Request) {
  const mod = await requireRole("moderator", "admin");
  if (!mod) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 30));

  const [total, works] = await Promise.all([
    db.publicWork.count(),
    db.publicWork.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return NextResponse.json({
    total,
    page,
    limit,
    works: works.map(publicWorkModOut),
  });
}
