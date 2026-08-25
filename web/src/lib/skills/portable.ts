import { z } from "zod";
import { SKILL_MODE_IDS, SKILL_OUTPUT_MODES } from "./definitions";

/**
 * 技能的导入 / 导出格式。纯的，两端共用。
 *
 * 刻意只是 `Skill` 的**公开字段子集**：不含 id / ownerId / isOverridden /
 * isActive / sortOrder。那些是「这条记录在这个库里的位置」，不是技能本身，
 * 跟着 JSON 走只会让导入方接管一份别人的内部状态。
 *
 * 带版本号是为了将来能加字段而不炸掉旧文件——没有版本号的话，第一次改格式
 * 就会让用户手里所有导出文件失效，而那是他们唯一的备份。
 */
export const SKILL_EXPORT_VERSION = 1;

/**
 * 用户能绑的时机只有**已经有前端实现**的那两个。
 *
 * 让用户勾 `block` / `slash` 只会造出一条永远不触发的技能，
 * 然后他会来问「为什么我的技能不工作」。S4 做完再放开。
 */
export const USER_TRIGGERS = ["selection", "manual"] as const;

export const portableSkillSchema = z.object({
  version: z.literal(SKILL_EXPORT_VERSION),
  /** 导出时带上，导入时**忽略**：key 是库里的身份，不能跟着文件走 */
  key: z.string().max(64).optional(),
  name: z.string().min(1).max(60),
  name_en: z.string().max(60).default(""),
  icon: z.string().max(60).default(""),
  description: z.string().max(200).default(""),
  triggers: z.array(z.enum(USER_TRIGGERS)).min(1),
  modes: z.array(z.enum(SKILL_MODE_IDS)).default([]),
  system_prompt: z.string().min(1).max(8000),
  user_template: z.string().min(1).max(8000),
  output_mode: z.enum(SKILL_OUTPUT_MODES).default("replace"),
  max_output_tokens: z.number().int().min(50).max(1200).default(600),
  temperature: z.number().min(0).max(2).default(0.4),
  /** 来源官方技能。导入时会校验它确实存在，不存在就丢掉——那只是一条提示 */
  forked_from_key: z.string().max(64).nullable().optional(),
});

export type PortableSkill = z.infer<typeof portableSkillSchema>;

type SkillLike = {
  key: string;
  name: string;
  nameEn: string;
  icon: string;
  description: string;
  triggers: string[];
  modes: string[];
  systemPrompt: string;
  userTemplate: string;
  outputMode: string;
  maxOutputTokens: number;
  temperature: number;
  forkedFromKey?: string | null;
};

export function toPortable(skill: SkillLike): PortableSkill {
  return {
    version: SKILL_EXPORT_VERSION,
    key: skill.key,
    name: skill.name,
    name_en: skill.nameEn,
    icon: skill.icon,
    description: skill.description,
    triggers: skill.triggers.filter((t): t is (typeof USER_TRIGGERS)[number] =>
      (USER_TRIGGERS as readonly string[]).includes(t)
    ),
    modes: skill.modes as PortableSkill["modes"],
    system_prompt: skill.systemPrompt,
    user_template: skill.userTemplate,
    output_mode: skill.outputMode as PortableSkill["output_mode"],
    max_output_tokens: skill.maxOutputTokens,
    temperature: skill.temperature,
    ...(skill.forkedFromKey ? { forked_from_key: skill.forkedFromKey } : {}),
  };
}
