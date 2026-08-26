import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { hasSkillAuthoring, MAX_USER_SKILLS } from "@/lib/skills/access";
import {
  getOfficialSkill,
  hasLinkedFork,
  linkedForkKeys,
  listUserSkills,
  newUserSkillKey,
  sourceUpdated,
  type ResolvedSkill,
} from "@/lib/skills/store";
import { portableSkillSchema, toPortable, USER_TRIGGERS } from "@/lib/skills/portable";
import { OFFICIAL_SKILL_BY_KEY, SKILL_MODE_IDS, SKILL_OUTPUT_MODES } from "@/lib/skills/definitions";
import { TEMPLATE_VARIABLES } from "@/lib/skills/variables";
import { AUTO_MODEL_KEY, canUseModel, listLlmModels } from "@/lib/llm/model-store";
import { hasAdultAccess } from "@/lib/adult-access";
import { isVipActive } from "@/lib/pricing";

/**
 * 用户自己的技能。
 *
 * 用户对官方技能只有两个动作：**用**、**复制一份改**。不能就地编辑官方技能——
 * 官方技能随版本升级，允许就地改等于把这个用户从升级链路上摘下来，
 * 而且分不清「这条技能表现变差」是官方改的还是他自己改的。
 */

function skillOut(skill: ResolvedSkill, officialUpdatedAt: Map<string, Date>) {
  return {
    id: skill.id,
    key: skill.key,
    name: skill.name,
    icon: skill.icon,
    description: skill.description,
    triggers: skill.triggers,
    modes: skill.modes,
    system_prompt: skill.systemPrompt,
    user_template: skill.userTemplate,
    output_mode: skill.outputMode,
    max_output_tokens: skill.maxOutputTokens,
    temperature: skill.temperature,
    model_key: skill.modelKey,
    is_active: skill.isActive,
    /**
     * 还在跟随官方吗。
     *
     * 跟随中 = 这只是一个引用，官方一变它就跟着变；
     * 已独立 = 用户改过提示词，它落地成了自己的东西，从此不再跟随。
     */
    linked: !skill.isOverridden && Boolean(skill.forkedFromKey),
    forked_from_key: skill.forkedFromKey,
    forked_from_name: skill.forkedFromKey
      ? (OFFICIAL_SKILL_BY_KEY.get(skill.forkedFromKey)?.name ?? skill.forkedFromKey)
      : null,
    /** 来源技能在 fork 之后更新过。只提示，**不自动合并** */
    source_updated: skill.forkedFromKey
      ? sourceUpdated(skill, officialUpdatedAt.get(skill.forkedFromKey))
      : false,
    /** 导出用的原样载荷，前端直接存成 .json */
    portable: toPortable({ ...skill, nameEn: skill.nameEn }),
  };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const canAuthor = hasSkillAuthoring(user);
  const [skills, officials, linked] = await Promise.all([
    listUserSkills(user.id),
    db.skill.findMany({ where: { scope: "official" }, select: { key: true, updatedAt: true } }),
    linkedForkKeys(user.id),
  ]);
  const officialUpdatedAt = new Map(officials.map((o) => [o.key, o.updatedAt]));

  return NextResponse.json({
    can_author: canAuthor,
    quota: { used: skills.length, max: MAX_USER_SKILLS },
    skills: skills.map((s) => skillOut(s, officialUpdatedAt)),
    /** 可以 fork 的官方技能。这里同样只回名字，不回提示词 */
    forkable: (
      await db.skill.findMany({
        where: { scope: "official", isActive: true },
        select: { key: true, name: true, icon: true, description: true },
        orderBy: [{ sortOrder: "asc" }],
      })
    ).map((o) => ({
      key: o.key,
      name: o.name,
      icon: o.icon,
      description: o.description,
      /*
       * 已经有一份还在跟随的副本了，就不给再复制第二份——
       * 两份内容完全一样、又都会自动跟着官方变，留着只会让列表变乱。
       * 改过之后那份变成独立技能，这里会重新亮起来。
       */
      has_linked_copy: linked.has(o.key),
    })),
    meta: {
      triggers: USER_TRIGGERS,
      modes: SKILL_MODE_IDS,
      output_modes: SKILL_OUTPUT_MODES,
      variables: TEMPLATE_VARIABLES,
      /*
       * 只列这个人用得上的模型。用不上的**不显示**而不是显示后禁用——
       * 列一排点不动的选项，除了让人去猜「我要充到什么档」没有别的作用。
       */
      models: [
        { key: AUTO_MODEL_KEY, label: "自动（按是否成人模式选档）", tier: "" },
        ...(await listLlmModels())
          .filter((m) =>
            canUseModel(m, {
              vipRank: isVipActive(user) ? (user.vipTier?.rank ?? 0) : 0,
              adultAccess: hasAdultAccess(user),
            })
          )
          .map((m) => ({ key: m.key, label: m.label, tier: m.tierCode })),
      ],
    },
  });
}

const createSchema = z.discriminatedUnion("from", [
  z.object({ from: z.literal("blank") }),
  z.object({ from: z.literal("fork"), key: z.string().min(1).max(64) }),
  z.object({ from: z.literal("import"), payload: portableSkillSchema }),
]);

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasSkillAuthoring(user)) {
    return NextResponse.json(
      { error: "当前账号没有自建技能的权限", code: "SKILL_AUTHORING_REQUIRED" },
      { status: 403 }
    );
  }
  if (!rateLimit(`skill-create:${user.id}`, 20, 60_000)) {
    return NextResponse.json({ error: "操作过于频繁，请稍后再试" }, { status: 429 });
  }

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "参数无效" },
      { status: 400 }
    );
  }

  const used = await db.skill.count({ where: { scope: "user", ownerId: user.id } });
  if (used >= MAX_USER_SKILLS) {
    return NextResponse.json(
      { error: `技能数量已达上限（${MAX_USER_SKILLS} 条），请先删掉一些`, code: "SKILL_QUOTA" },
      { status: 400 }
    );
  }

  const input = parsed.data;
  let data: {
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
    forkedFromKey: string | null;
    forkedFromAt: Date | null;
  };

  /*
   * 从零建与导入的技能**一出生就是独立的**：它们没有在跟随任何东西。
   * 导入这条尤其要紧——导出文件里可能带着 forked_from_key，
   * 若把它当成「跟随中」，下一次官方更新会把用户导进来的内容整个冲掉。
   */
  let independent = true;

  if (input.from === "fork") {
    const official = await getOfficialSkill(input.key);
    if (!official) return NextResponse.json({ error: "来源技能不存在" }, { status: 404 });
    if (await hasLinkedFork(user.id, input.key)) {
      return NextResponse.json(
        { error: "已经有一份跟随中的副本了，改过之后才能再复制一份", code: "SKILL_ALREADY_FORKED" },
        { status: 400 }
      );
    }
    independent = false;
    const row = await db.skill.findFirst({
      where: { key: input.key, scope: "official" },
      select: { updatedAt: true },
    });
    /*
     * fork 拿到的是官方技能的完整 systemPrompt。这**是有意的**——
     * fork 的意义就在于此，所以官方技能的提示词不应包含任何机密。
     */
    data = {
      name: `${official.name}（我的）`,
      nameEn: official.nameEn,
      icon: official.icon,
      description: official.description,
      // 官方技能可能绑了用户还用不上的时机，滤掉再存
      triggers: official.triggers.filter((t) => (USER_TRIGGERS as readonly string[]).includes(t)),
      modes: official.modes,
      systemPrompt: official.systemPrompt,
      userTemplate: official.userTemplate,
      outputMode: official.outputMode,
      maxOutputTokens: Math.min(official.maxOutputTokens, 1200),
      temperature: official.temperature,
      forkedFromKey: official.key,
      forkedFromAt: row?.updatedAt ?? new Date(),
    };
    if (data.triggers.length === 0) {
      return NextResponse.json({ error: "这条技能的触发时机还不支持自建" }, { status: 400 });
    }
  } else if (input.from === "import") {
    const p = input.payload;
    // forked_from_key 只是一条来源提示，指向不存在的官方技能就丢掉，不报错
    const known = p.forked_from_key && OFFICIAL_SKILL_BY_KEY.has(p.forked_from_key);
    data = {
      name: p.name,
      nameEn: p.name_en,
      icon: p.icon,
      description: p.description,
      triggers: p.triggers,
      modes: p.modes,
      systemPrompt: p.system_prompt,
      userTemplate: p.user_template,
      outputMode: p.output_mode,
      maxOutputTokens: p.max_output_tokens,
      temperature: p.temperature,
      forkedFromKey: known ? (p.forked_from_key ?? null) : null,
      forkedFromAt: null,
    };
  } else {
    data = {
      name: "新技能",
      nameEn: "",
      icon: "fa-wand-sparkles",
      description: "",
      triggers: ["selection"],
      modes: [],
      systemPrompt: "任务：",
      userTemplate: "{{selection}}",
      outputMode: "replace",
      maxOutputTokens: 600,
      temperature: 0.4,
      forkedFromKey: null,
      forkedFromAt: null,
    };
  }

  const created = await db.skill.create({
    data: {
      scope: "user",
      ownerId: user.id,
      key: newUserSkillKey(),
      ...data,
      triggers: JSON.stringify(data.triggers),
      modes: JSON.stringify(data.modes),
      /*
       * 用户技能一律用 "auto"（按成人模式自动选档）。
       * 让用户自己填 modelKey 就等于绕开 VIP 档位门槛直接点名贵模型。
       */
      modelKey: "auto",
      isActive: true,
      /* 见上面 independent 的说明：fork 出来的是引用，其余都是实体 */
      isOverridden: independent,
      sortOrder: 100,
    },
  });

  return NextResponse.json({ ok: true, id: created.id, key: created.key }, { status: 201 });
}
