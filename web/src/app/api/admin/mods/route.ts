import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAdminAction } from "@/lib/admin-audit";

/** 审核员列表：role=moderator，含封禁状态 */
export async function GET() {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const mods = await db.user.findMany({
    where: { role: "moderator" },
    select: {
      id: true,
      username: true,
      role: true,
      balance: true,
      disabledAt: true,
      createdAt: true,
      _count: { select: { generations: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    mods: mods.map((m) => ({
      id: m.id,
      username: m.username,
      role: m.role,
      balance: m.balance,
      disabled_at: m.disabledAt,
      created_at: m.createdAt,
      generation_count: m._count.generations,
      enabled: !m.disabledAt,
    })),
  });
}

const grantSchema = z.object({
  username: z.string().min(1).max(64),
});

/** 将已有用户提升为 moderator（若被封禁则一并解封） */
export async function POST(req: Request) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = grantSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "请提供用户名" }, { status: 400 });
  }

  const user = await db.user.findUnique({ where: { username: parsed.data.username.trim() } });
  if (!user) return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  if (user.role === "admin") {
    return NextResponse.json({ error: "不能把管理员改成审核员" }, { status: 400 });
  }

  const updated = await db.user.update({
    where: { id: user.id },
    data: { role: "moderator", disabledAt: null },
  });

  await logAdminAction(admin.id, "mod_grant", { type: "user", id: user.id }, {
    username: user.username,
  });

  return NextResponse.json({
    ok: true,
    mod: {
      id: updated.id,
      username: updated.username,
      role: updated.role,
      disabled_at: updated.disabledAt,
      enabled: true,
    },
  });
}
