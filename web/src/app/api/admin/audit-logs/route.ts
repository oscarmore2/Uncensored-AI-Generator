import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";

/** 管理端审计日志：分页，按 action 筛选 */
export async function GET(req: Request) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 30));
  const action = url.searchParams.get("action");

  const where = action ? { action } : {};

  const [total, logs, admins] = await Promise.all([
    db.adminAuditLog.count({ where }),
    db.adminAuditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.user.findMany({
      where: { role: "admin" },
      select: { id: true, username: true },
    }),
  ]);

  const adminMap = new Map(admins.map((a) => [a.id, a.username]));

  return NextResponse.json({
    total,
    page,
    limit,
    logs: logs.map((l) => ({
      id: l.id,
      admin_id: l.adminId,
      admin_username: adminMap.get(l.adminId) ?? `#${l.adminId}`,
      action: l.action,
      target_type: l.targetType,
      target_id: l.targetId,
      detail: l.detail ? JSON.parse(l.detail) : null,
      created_at: l.createdAt,
    })),
  });
}
