import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { publicWorkOut } from "@/lib/serialize";

/** 游客可访问的公共作品列表（仅已上架），分页 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const limit = Math.min(48, Math.max(1, Number(url.searchParams.get("limit")) || 24));
  const mode = url.searchParams.get("mode");

  const where = {
    isPublished: true,
    ...(mode ? { mode } : {}),
  };

  const [total, works] = await Promise.all([
    db.publicWork.count({ where }),
    db.publicWork.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return NextResponse.json({
    total,
    page,
    limit,
    works: works.map(publicWorkOut),
  });
}
