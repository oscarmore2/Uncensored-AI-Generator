import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAdminAction } from "@/lib/admin-audit";
import { OFFICIAL_SKILL_BY_KEY } from "@/lib/skills/definitions";
import { factoryFields } from "@/lib/skills/store";

/**
 * 恢复出厂设置：回填出厂值 + `isOverridden = false`。
 *
 * 第二件事和第一件一样重要——清掉标记之后这条技能重新回到升级链路上，
 * 以后我们改进提示词它会自动跟上。只回填不清标记的话，它会永远停在
 * 「恢复的那一刻」的版本。
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "参数无效" }, { status: 400 });

  const current = await db.skill.findUnique({ where: { id } });
  if (!current) return NextResponse.json({ error: "技能不存在" }, { status: 404 });

  const factory = OFFICIAL_SKILL_BY_KEY.get(current.key);
  if (!factory) {
    return NextResponse.json(
      { error: "这条技能在当前版本里没有出厂定义，只能手动改或停用" },
      { status: 400 }
    );
  }

  await db.skill.update({
    where: { id },
    data: { ...factoryFields(factory), isActive: true, isOverridden: false },
  });

  await logAdminAction(admin.id, "skill_restore", { type: "skill", id }, { key: current.key });
  return NextResponse.json({ ok: true });
}
