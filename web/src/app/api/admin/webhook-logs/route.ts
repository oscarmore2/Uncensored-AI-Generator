import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";

/** Webhook 事件日志：分页，按 provider 筛选 */
export async function GET(req: Request) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 30));
  const provider = url.searchParams.get("provider");

  const where = provider ? { provider } : {};

  const [total, logs] = await Promise.all([
    db.webhookEventLog.count({ where }),
    db.webhookEventLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return NextResponse.json({
    total,
    page,
    limit,
    logs: logs.map((l) => ({
      id: l.id,
      provider: l.provider,
      event_type: l.eventType,
      external_id: l.externalId,
      status: l.status,
      detail: l.detail,
      created_at: l.createdAt,
    })),
  });
}
