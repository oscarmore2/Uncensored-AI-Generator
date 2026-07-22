import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAdminAction } from "@/lib/admin-audit";

const patchSchema = z
  .object({
    /** true=启用（解封），false=停用（封禁登录） */
    enabled: z.boolean().optional(),
    /** true=保留 moderator，false=降级为普通 user */
    keep_role: z.boolean().optional(),
  })
  .refine((v) => v.enabled !== undefined || v.keep_role !== undefined, "至少提供一个字段");

/**
 * 启停审核员账号。
 * - enabled=false：封禁登录（默认保留 moderator 角色，解封后仍是 mod）
 * - enabled=true：解封
 * - keep_role=false：降级为 user（同时清除封禁）
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const userId = Number(id);
  if (!Number.isInteger(userId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, { status: 400 });
  }

  const target = await db.user.findUnique({ where: { id: userId } });
  if (!target) return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  if (target.role !== "moderator" && parsed.data.keep_role !== false) {
    return NextResponse.json({ error: "该用户不是审核员" }, { status: 400 });
  }
  if (target.role === "admin") {
    return NextResponse.json({ error: "不能操作管理员账号" }, { status: 400 });
  }

  const updated = await db.user.update({
    where: { id: userId },
    data: {
      ...(parsed.data.enabled === false ? { disabledAt: new Date() } : {}),
      ...(parsed.data.enabled === true ? { disabledAt: null } : {}),
      ...(parsed.data.keep_role === false ? { role: "user", disabledAt: null } : {}),
    },
  });

  await logAdminAction(admin.id, "mod_toggle", { type: "user", id: userId }, {
    enabled: parsed.data.enabled,
    keep_role: parsed.data.keep_role,
  });

  return NextResponse.json({
    ok: true,
    mod: {
      id: updated.id,
      username: updated.username,
      role: updated.role,
      disabled_at: updated.disabledAt,
      enabled: !updated.disabledAt,
    },
  });
}
