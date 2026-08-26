import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAdminAction } from "@/lib/admin-audit";
import { SKILL_MODE_IDS, SKILL_OUTPUT_MODES, SKILL_TRIGGERS } from "@/lib/skills/definitions";
import { propagateToLinkedForks } from "@/lib/skills/store";

const patchSchema = z
  .object({
    name: z.string().min(1).max(60).optional(),
    name_en: z.string().max(60).optional(),
    icon: z.string().max(60).optional(),
    description: z.string().max(200).optional(),
    triggers: z.array(z.enum(SKILL_TRIGGERS)).min(1).optional(),
    modes: z.array(z.enum(SKILL_MODE_IDS)).optional(),
    section_levels: z.array(z.union([z.literal(1), z.literal(2), z.literal(3)])).optional(),
    system_prompt: z.string().min(1).max(8000).optional(),
    user_template: z.string().min(1).max(8000).optional(),
    model_key: z.string().min(1).max(80).optional(),
    output_mode: z.enum(SKILL_OUTPUT_MODES).optional(),
    max_output_tokens: z.number().int().min(50).max(4000).optional(),
    temperature: z.number().min(0).max(2).optional(),
    requires_vip_rank: z.number().int().min(0).max(10).optional(),
    is_active: z.boolean().optional(),
    sort_order: z.number().int().min(0).max(9999).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "没有要修改的字段" });

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "参数无效" }, { status: 400 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, { status: 400 });
  }
  const d = parsed.data;

  const current = await db.skill.findUnique({ where: { id } });
  if (!current) return NextResponse.json({ error: "技能不存在" }, { status: 404 });

  const updated = await db.skill.update({
    where: { id },
    data: {
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.name_en !== undefined ? { nameEn: d.name_en } : {}),
      ...(d.icon !== undefined ? { icon: d.icon } : {}),
      ...(d.description !== undefined ? { description: d.description } : {}),
      ...(d.triggers !== undefined ? { triggers: JSON.stringify(d.triggers) } : {}),
      ...(d.modes !== undefined ? { modes: JSON.stringify(d.modes) } : {}),
      ...(d.section_levels !== undefined
        ? { sectionLevels: JSON.stringify(d.section_levels) }
        : {}),
      ...(d.system_prompt !== undefined ? { systemPrompt: d.system_prompt } : {}),
      ...(d.user_template !== undefined ? { userTemplate: d.user_template } : {}),
      ...(d.model_key !== undefined ? { modelKey: d.model_key } : {}),
      ...(d.output_mode !== undefined ? { outputMode: d.output_mode } : {}),
      ...(d.max_output_tokens !== undefined ? { maxOutputTokens: d.max_output_tokens } : {}),
      ...(d.temperature !== undefined ? { temperature: d.temperature } : {}),
      ...(d.requires_vip_rank !== undefined ? { requiresVipRank: d.requires_vip_rank } : {}),
      ...(d.is_active !== undefined ? { isActive: d.is_active } : {}),
      ...(d.sort_order !== undefined ? { sortOrder: d.sort_order } : {}),
      /*
       * 改过就打上标记，此后版本升级不再覆盖它。
       * 连「停用」也算改过——不然下次部署会把它重新启用，而运营
       * 明明是有意关掉的。
       */
      isOverridden: true,
    },
  });

  /*
   * 用户手里那些**还在跟随**这条官方技能的副本要一起跟上。
   * 已经改过、落地成独立技能的那些一个字都不动。
   */
  const propagated = current.scope === "official" ? await propagateToLinkedForks(current.key) : 0;

  await logAdminAction(admin.id, "skill_edit", { type: "skill", id }, {
    key: current.key,
    fields: Object.keys(d),
    propagated,
  });

  return NextResponse.json({ ok: true, id: updated.id, propagated });
}
