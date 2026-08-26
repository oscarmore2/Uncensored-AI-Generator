import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import {
  OFFICIAL_SKILL_BY_KEY,
  SKILL_MODE_IDS,
  SKILL_OUTPUT_MODES,
  SKILL_SECTION_LEVELS,
  SKILL_TRIGGERS,
} from "@/lib/skills/definitions";
import { diffFromFactory, ensureSkillsSeeded, skillFromRow } from "@/lib/skills/store";
import { TEMPLATE_VARIABLES } from "@/lib/skills/variables";
import { AUTO_MODEL_KEY, listLlmModels } from "@/lib/llm/model-store";

export async function GET() {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await ensureSkillsSeeded();
  const rows = await db.skill.findMany({
    where: { scope: "official" },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });

  return NextResponse.json({
    skills: rows.map((row) => {
      const skill = skillFromRow(row);
      const factory = OFFICIAL_SKILL_BY_KEY.get(skill.key);
      return {
        id: skill.id,
        key: skill.key,
        name: skill.name,
        name_en: skill.nameEn,
        icon: skill.icon,
        description: skill.description,
        triggers: skill.triggers,
        modes: skill.modes,
        section_levels: skill.sectionLevels,
        system_prompt: skill.systemPrompt,
        user_template: skill.userTemplate,
        model_key: skill.modelKey,
        output_mode: skill.outputMode,
        max_output_tokens: skill.maxOutputTokens,
        temperature: skill.temperature,
        requires_vip_rank: skill.requiresVipRank,
        is_active: skill.isActive,
        sort_order: skill.sortOrder,
        is_overridden: skill.isOverridden,
        /** 出厂清单里已经没有这个 key 了：只能停用，不能删（否则播种会建回来） */
        has_factory: Boolean(factory),
        /** 哪些字段与出厂值不一样。运营得看得见自己改过什么 */
        drift: diffFromFactory(skill),
        factory: factory
          ? { system_prompt: factory.systemPrompt, user_template: factory.userTemplate }
          : null,
      };
    }),
    meta: {
      triggers: SKILL_TRIGGERS,
      /** S4 之前只有这两个时机真的有前端实现，其余勾了也不会触发 */
      implemented_triggers: ["selection", "manual", "section"],
      output_modes: SKILL_OUTPUT_MODES,
      modes: SKILL_MODE_IDS,
      section_levels: SKILL_SECTION_LEVELS,
      variables: TEMPLATE_VARIABLES,
      /* 管理端不受 VIP / 成人验证限制，但绑了带门槛的模型，够不着的用户就看不到这条技能 */
      models: [
        { key: AUTO_MODEL_KEY, label: "自动（按是否成人模式选档）", tier: "", gated: false },
        ...(await listLlmModels()).map((m) => ({
          key: m.key,
          label: m.label,
          tier: m.tierCode,
          gated: m.requiresVipRank > 0 || m.requiresAdult,
        })),
      ],
    },
  });
}
