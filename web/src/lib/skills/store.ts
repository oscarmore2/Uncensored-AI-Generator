import "server-only";
import crypto from "crypto";
import { db } from "../db";
import {
  OFFICIAL_SKILLS,
  OFFICIAL_SKILL_BY_KEY,
  type SkillDefinition,
  type SkillOutputMode,
  type SkillTrigger,
} from "./definitions";

/**
 * 技能的读写与播种。
 *
 * 播种规则与 `pricing-seed.ts` 的「只补不改」**刻意不同**（规划第三节）：
 *
 * | 情况 | 行为 |
 * | --- | --- |
 * | 库里没有该 key | 按出厂值建行，`isOverridden = false` |
 * | 有，且未被改过 | **用出厂值覆盖**——代码升级了提示词，没被动过的自动跟上 |
 * | 有，且已被改过 | 一个字都不动 |
 *
 * 差别的理由：价格是运营数据，提示词是产品数据。运营改过的价格绝不能被
 * 一次部署重置；而我们改进了一版润色提示词，没人动过的技能应该跟上，
 * 否则老站点会永远停在第一版。
 */

export type ResolvedSkill = {
  id: number | null;
  scope: string;
  ownerId: number | null;
  key: string;
  name: string;
  nameEn: string;
  icon: string;
  description: string;
  triggers: string[];
  modes: string[];
  systemPrompt: string;
  userTemplate: string;
  modelKey: string;
  outputMode: SkillOutputMode;
  maxOutputTokens: number;
  temperature: number;
  requiresVipRank: number;
  isActive: boolean;
  sortOrder: number;
  isOverridden: boolean;
  forkedFromKey: string | null;
  forkedFromAt: Date | null;
};

type SkillRow = {
  id: number;
  scope: string;
  ownerId: number | null;
  key: string;
  name: string;
  nameEn: string;
  icon: string;
  description: string;
  triggers: string;
  modes: string;
  systemPrompt: string;
  userTemplate: string;
  modelKey: string;
  outputMode: string;
  maxOutputTokens: number;
  temperature: number;
  requiresVipRank: number;
  isActive: boolean;
  sortOrder: number;
  isOverridden: boolean;
  forkedFromKey: string | null;
  forkedFromAt: Date | null;
};

function parseList(raw: string): string[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function skillFromRow(row: SkillRow): ResolvedSkill {
  return {
    id: row.id,
    scope: row.scope,
    ownerId: row.ownerId,
    key: row.key,
    name: row.name,
    nameEn: row.nameEn,
    icon: row.icon,
    description: row.description,
    triggers: parseList(row.triggers),
    modes: parseList(row.modes),
    systemPrompt: row.systemPrompt,
    userTemplate: row.userTemplate,
    modelKey: row.modelKey,
    outputMode: row.outputMode as SkillOutputMode,
    maxOutputTokens: row.maxOutputTokens,
    temperature: row.temperature,
    requiresVipRank: row.requiresVipRank,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    isOverridden: row.isOverridden,
    forkedFromKey: row.forkedFromKey,
    forkedFromAt: row.forkedFromAt,
  };
}

export function skillFromDefinition(def: SkillDefinition): ResolvedSkill {
  return {
    id: null,
    scope: "official",
    ownerId: null,
    key: def.key,
    name: def.name,
    nameEn: def.nameEn,
    icon: def.icon,
    description: def.description,
    triggers: def.triggers,
    modes: def.modes,
    systemPrompt: def.systemPrompt,
    userTemplate: def.userTemplate,
    modelKey: def.modelKey,
    outputMode: def.outputMode,
    maxOutputTokens: def.maxOutputTokens,
    temperature: def.temperature,
    requiresVipRank: def.requiresVipRank,
    isActive: true,
    sortOrder: def.sortOrder,
    isOverridden: false,
    forkedFromKey: null,
    forkedFromAt: null,
  };
}

/** 出厂值 → 可直接写库的字段 */
export function factoryFields(def: SkillDefinition) {
  return {
    name: def.name,
    nameEn: def.nameEn,
    icon: def.icon,
    description: def.description,
    triggers: JSON.stringify(def.triggers),
    modes: JSON.stringify(def.modes),
    systemPrompt: def.systemPrompt,
    userTemplate: def.userTemplate,
    modelKey: def.modelKey,
    outputMode: def.outputMode,
    maxOutputTokens: def.maxOutputTokens,
    temperature: def.temperature,
    requiresVipRank: def.requiresVipRank,
    sortOrder: def.sortOrder,
  };
}

let seeding = false;
let seeded = false;

export async function ensureSkillsSeeded(): Promise<void> {
  if (seeded) return;
  if (seeding) {
    while (seeding) await new Promise((r) => setTimeout(r, 20));
    return;
  }
  seeding = true;
  try {
    const existing = await db.skill.findMany({
      where: { scope: "official" },
      select: { key: true, isOverridden: true },
    });
    const byKey = new Map(existing.map((r) => [r.key, r]));

    for (const def of OFFICIAL_SKILLS) {
      const row = byKey.get(def.key);
      if (!row) {
        await db.skill.create({
          data: {
            scope: "official",
            key: def.key,
            isActive: true,
            // 显式写出来而不是靠 schema 默认值：这是播种规则的核心状态，
            // 读这段代码的人不该还要翻 schema 才知道新建的行跟不跟随升级
            isOverridden: false,
            ...factoryFields(def),
          },
        });
        continue;
      }
      // 被管理端改过就一个字都不动，包括 isActive
      if (row.isOverridden) continue;
      await db.skill.update({
        where: { key: def.key },
        data: { ...factoryFields(def), isActive: true },
      });
    }
    /*
     * 出厂清单里没有、但库里还留着的官方技能**不删**：
     * 删掉会让 forkedFromKey 变悬空，也让下次启动又建回来。
     * 要下线就在管理端停用。
     */
    seeded = true;
  } catch (err) {
    console.error("[skill-store] seed failed:", err);
  } finally {
    seeding = false;
  }
}

/**
 * 取某个时机下可用的技能。
 *
 * `formatId` 用来做模式过滤：技能的 `modes` 为空数组表示全模式，
 * 否则只在列出的模式下出现。不过滤的话，文生图的菜单会被一堆
 * 视频专用技能塞满。
 */
export async function listSkills(opts: {
  trigger: SkillTrigger;
  formatId?: string;
  /** 管理端要看全部，创作端只要启用的 */
  includeInactive?: boolean;
  /** 带上这个用户自己的技能。**别人的永远不会出现在这里** */
  ownerId?: number;
}): Promise<ResolvedSkill[]> {
  let all: ResolvedSkill[];
  try {
    await ensureSkillsSeeded();
    const rows = await db.skill.findMany({
      where: {
        OR: [
          { scope: "official" },
          ...(opts.ownerId ? [{ scope: "user", ownerId: opts.ownerId }] : []),
        ],
      },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    });
    all = rows.length > 0 ? rows.map(skillFromRow) : OFFICIAL_SKILLS.map(skillFromDefinition);
  } catch (err) {
    // 库连不上时不该让编辑器里的 AI 菜单整个消失
    console.error("[skill-store] list failed, using built-in defaults:", err);
    all = OFFICIAL_SKILLS.map(skillFromDefinition);
  }

  return all.filter((s) => {
    if (!opts.includeInactive && !s.isActive) return false;
    if (!s.triggers.includes(opts.trigger)) return false;
    if (s.modes.length > 0 && opts.formatId && !s.modes.includes(opts.formatId)) return false;
    return true;
  });
}

/** 测试用：清掉「本进程已播种」的记忆 */
export function __resetSkillSeed() {
  seeded = false;
  seeding = false;
}

/** 这个人自己的技能，管理用。按最近改过的排在前面 */
export async function listUserSkills(ownerId: number): Promise<ResolvedSkill[]> {
  const rows = await db.skill.findMany({
    where: { scope: "user", ownerId },
    orderBy: [{ updatedAt: "desc" }],
  });
  return rows.map(skillFromRow);
}

/**
 * 取一个可以**执行**的技能。
 *
 * 这是整个技能系统最要紧的一道门：官方技能人人可用，用户技能**只有作者本人**
 * 能跑。放开这一条，A 写的 systemPrompt 就会跑在 B 的内容上——那正是
 * 规划第〇节把「技能共享」整个划出去的原因，是完全不同量级的安全问题。
 *
 * 判据只有一条：`scope === "official"` 或 `ownerId === 当前用户`。
 * 别因为「反正 key 猜不到」就省掉它——key 会出现在导出文件里。
 */
export async function getSkillForRun(key: string, userId: number): Promise<ResolvedSkill | null> {
  try {
    await ensureSkillsSeeded();
    const row = await db.skill.findUnique({ where: { key } });
    if (row) {
      if (row.scope === "user" && row.ownerId !== userId) return null;
      return skillFromRow(row);
    }
  } catch (err) {
    console.error("[skill-store] get failed, using built-in defaults:", err);
  }
  const def = OFFICIAL_SKILL_BY_KEY.get(key);
  return def ? skillFromDefinition(def) : null;
}

/** 只取官方技能。fork 与管理端用 */
export async function getOfficialSkill(key: string): Promise<ResolvedSkill | null> {
  try {
    await ensureSkillsSeeded();
    const row = await db.skill.findFirst({ where: { key, scope: "official" } });
    if (row) return skillFromRow(row);
  } catch (err) {
    console.error("[skill-store] get official failed:", err);
  }
  const def = OFFICIAL_SKILL_BY_KEY.get(key);
  return def ? skillFromDefinition(def) : null;
}

/**
 * 用户技能的 key。
 *
 * 随机而不是从名字派生：名字可以重复、可以改、可以是纯 emoji，而 key 是全局
 * 唯一且一旦生成就不再变的东西。带 `u_` 前缀是为了一眼分辨出它不是官方技能。
 */
export function newUserSkillKey(): string {
  return `u_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/**
 * 来源官方技能在 fork 之后有没有更新过。
 *
 * **只提示，不自动合并**（规划第四节）：用户已经改过自己那一份，
 * 合并只能靠猜，猜错比不合并更糟。
 */
export function sourceUpdated(
  skill: Pick<ResolvedSkill, "forkedFromAt">,
  officialUpdatedAt: Date | null | undefined
): boolean {
  if (!skill.forkedFromAt || !officialUpdatedAt) return false;
  return officialUpdatedAt.getTime() > skill.forkedFromAt.getTime();
}

/** 与出厂值有哪些字段不一样。管理端要显示「已偏离出厂设置」的 diff */
export function diffFromFactory(skill: ResolvedSkill): string[] {
  const def = OFFICIAL_SKILL_BY_KEY.get(skill.key);
  if (!def) return [];
  const factory = skillFromDefinition(def);
  const fields: (keyof ResolvedSkill)[] = [
    "name",
    "nameEn",
    "icon",
    "description",
    "triggers",
    "modes",
    "systemPrompt",
    "userTemplate",
    "modelKey",
    "outputMode",
    "maxOutputTokens",
    "temperature",
    "requiresVipRank",
    "sortOrder",
  ];
  return fields.filter((f) => JSON.stringify(skill[f]) !== JSON.stringify(factory[f]));
}
