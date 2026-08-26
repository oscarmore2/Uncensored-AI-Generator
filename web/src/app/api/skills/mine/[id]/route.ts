import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { hasSkillAuthoring } from "@/lib/skills/access";
import { USER_TRIGGERS } from "@/lib/skills/portable";
import { SKILL_MODE_IDS, SKILL_OUTPUT_MODES } from "@/lib/skills/definitions";
import { sameAsSource, sourceMirror, type MirroredValues } from "@/lib/skills/store";
import { AUTO_MODEL_KEY, canUseModel, getLlmModelByKey } from "@/lib/llm/model-store";
import { hasAdultAccess } from "@/lib/adult-access";
import { isVipActive } from "@/lib/pricing";

const patchSchema = z
  .object({
    name: z.string().min(1).max(60).optional(),
    icon: z.string().max(60).optional(),
    description: z.string().max(200).optional(),
    triggers: z.array(z.enum(USER_TRIGGERS)).min(1).optional(),
    modes: z.array(z.enum(SKILL_MODE_IDS)).optional(),
    section_levels: z.array(z.union([z.literal(1), z.literal(2), z.literal(3)])).optional(),
    system_prompt: z.string().min(1).max(8000).optional(),
    user_template: z.string().min(1).max(8000).optional(),
    output_mode: z.enum(SKILL_OUTPUT_MODES).optional(),
    /* 上限与官方同口径。让用户自己填一个大数就等于绕开单次成本的硬顶 */
    max_output_tokens: z.number().int().min(50).max(1200).optional(),
    temperature: z.number().min(0).max(2).optional(),
    is_active: z.boolean().optional(),
    /** 绑定的模型。"auto" = 按是否成人模式自动选档 */
    model_key: z.string().min(1).max(80).optional(),
    /** 用户看过「来源已更新」的提示之后，可以把时间戳对齐，让提示消失 */
    acknowledge_source: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "没有要修改的字段" });

function parseList(raw: string): string[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** 取一条**属于当前用户**的技能。找不到与不属于他，一律当作不存在 */
async function ownOrNull(id: number, userId: number) {
  const row = await db.skill.findUnique({ where: { id } });
  if (!row || row.scope !== "user" || row.ownerId !== userId) return null;
  return row;
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasSkillAuthoring(user)) {
    return NextResponse.json(
      { error: "当前账号没有自建技能的权限", code: "SKILL_AUTHORING_REQUIRED" },
      { status: 403 }
    );
  }

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "参数无效" }, { status: 400 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, { status: 400 });
  }
  const d = parsed.data;

  /*
   * 归属校验放在这里而不是靠 where 条件顺带过滤：一次显式的查询，
   * 读代码的人一眼看得到「别人的技能改不了」。
   */
  const current = await ownOrNull(id, user.id);
  if (!current) return NextResponse.json({ error: "技能不存在" }, { status: 404 });

  /*
   * 模型的门禁在这里再判一次，不能只靠前端只列可用项——
   * 那份清单是给人看的，这里才是拦得住脚本的地方。
   */
  if (d.model_key !== undefined && d.model_key !== AUTO_MODEL_KEY) {
    const model = await getLlmModelByKey(d.model_key);
    const allowed =
      model &&
      canUseModel(model, {
        vipRank: isVipActive(user) ? (user.vipTier?.rank ?? 0) : 0,
        adultAccess: hasAdultAccess(user),
      });
    if (!allowed) {
      return NextResponse.json(
        { error: "当前账号还用不了这个模型", code: "MODEL_NOT_ALLOWED" },
        { status: 403 }
      );
    }
  }

  let forkedFromAt = current.forkedFromAt;
  if (d.acknowledge_source && current.forkedFromKey) {
    const official = await db.skill.findFirst({
      where: { key: current.forkedFromKey, scope: "official" },
      select: { updatedAt: true },
    });
    // 只是把提示消掉，**不合并任何内容**——合并只能靠猜
    forkedFromAt = official?.updatedAt ?? new Date();
  }

  /*
   * 「跟随」变「独立」就发生在这里。
   *
   * 复制官方技能得到的只是一个引用：官方一变它跟着变。用户把提示词真的改成
   * 与官方**当前内容**不同的样子并保存下来，它才落地成一份独立的技能，
   * 从此不再跟随，官方那条的复制按钮也重新亮起来。
   *
   * 改名字、换图标、写说明、停用都不算——那些是用户自己的东西，
   * 不该让一份副本因为改了个名就掉出升级链路。
   */
  let isOverridden = current.isOverridden;
  let detached = false;
  if (!isOverridden && current.forkedFromKey) {
    const next: MirroredValues = {
      systemPrompt: d.system_prompt ?? current.systemPrompt,
      userTemplate: d.user_template ?? current.userTemplate,
      triggers: d.triggers ?? parseList(current.triggers),
      modes: d.modes ?? parseList(current.modes),
      sectionLevels: d.section_levels ?? parseList(current.sectionLevels).map(Number),
      outputMode: (d.output_mode ?? current.outputMode) as MirroredValues["outputMode"],
      maxOutputTokens: d.max_output_tokens ?? current.maxOutputTokens,
      temperature: d.temperature ?? current.temperature,
      modelKey: d.model_key ?? current.modelKey,
    };
    const mirror = await sourceMirror(current.forkedFromKey);
    // 来源不见了也当作独立：一个跟随着不存在的东西的副本毫无意义
    if (!mirror || !sameAsSource(next, mirror)) {
      isOverridden = true;
      detached = true;
      const official = await db.skill.findFirst({
        where: { key: current.forkedFromKey, scope: "official" },
        select: { updatedAt: true },
      });
      // 从落地这一刻起算，之后官方再改才提示「来源已更新」
      forkedFromAt = official?.updatedAt ?? new Date();
    }
  }

  await db.skill.update({
    where: { id },
    data: {
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.icon !== undefined ? { icon: d.icon } : {}),
      ...(d.description !== undefined ? { description: d.description } : {}),
      ...(d.triggers !== undefined ? { triggers: JSON.stringify(d.triggers) } : {}),
      ...(d.modes !== undefined ? { modes: JSON.stringify(d.modes) } : {}),
      ...(d.section_levels !== undefined
        ? { sectionLevels: JSON.stringify(d.section_levels) }
        : {}),
      ...(d.system_prompt !== undefined ? { systemPrompt: d.system_prompt } : {}),
      ...(d.user_template !== undefined ? { userTemplate: d.user_template } : {}),
      ...(d.output_mode !== undefined ? { outputMode: d.output_mode } : {}),
      ...(d.max_output_tokens !== undefined ? { maxOutputTokens: d.max_output_tokens } : {}),
      ...(d.temperature !== undefined ? { temperature: d.temperature } : {}),
      ...(d.is_active !== undefined ? { isActive: d.is_active } : {}),
      ...(d.model_key !== undefined ? { modelKey: d.model_key } : {}),
      isOverridden,
      forkedFromAt,
    },
  });

  return NextResponse.json({ ok: true, detached });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "参数无效" }, { status: 400 });

  /*
   * 用户技能**可以删**，与官方技能相反。官方的删了会让 forkedFromKey 悬空、
   * 也会被下次播种建回来；用户自己的没有这两个问题，而「只能停用不能删」
   * 会让技能列表越攒越长。
   *
   * 删除权限只要求登录 + 归属，不要求 skillAuthoring：权限被收回的用户
   * 仍然应该能清理掉自己的东西。
   */
  const current = await ownOrNull(id, user.id);
  if (!current) return NextResponse.json({ error: "技能不存在" }, { status: 404 });

  await db.skill.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
