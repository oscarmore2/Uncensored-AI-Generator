import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";

function parseDateParam(s: string | null, endOfDay = false): Date | null {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  if (endOfDay) d.setHours(23, 59, 59, 999);
  else d.setHours(0, 0, 0, 0);
  return d;
}

function buildWhere(url: URL) {
  const type = url.searchParams.get("type");
  const method = url.searchParams.get("method");
  const userId = Number(url.searchParams.get("user_id")) || null;
  const from = parseDateParam(url.searchParams.get("from"));
  const to = parseDateParam(url.searchParams.get("to"), true);

  return {
    ...(type ? { type } : {}),
    ...(method ? { method } : {}),
    ...(userId ? { userId } : {}),
    ...(from || to
      ? {
          createdAt: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        }
      : {}),
  };
}

function csvEscape(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** 导出交易流水 CSV（同筛选条件，最多 5000 行） */
export async function GET(req: Request) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const where = buildWhere(url);

  const txs = await db.transaction.findMany({
    where,
    include: { user: { select: { username: true } } },
    orderBy: { createdAt: "desc" },
    take: 5000,
  });

  const header = "id,user_id,username,type,amount,price_cents,method,stripe_payment_id,created_at";
  const rows = txs.map((t) =>
    [
      t.id,
      t.userId,
      csvEscape(t.user.username),
      t.type,
      t.amount,
      t.priceCents ?? "",
      csvEscape(t.method),
      csvEscape(t.stripePaymentId),
      t.createdAt.toISOString(),
    ].join(",")
  );

  const csv = [header, ...rows].join("\n");
  const filename = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
