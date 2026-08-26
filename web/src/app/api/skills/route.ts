import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { GENERATION_MODES, GENERATION_TIERS } from "@/lib/generation-modes";
import { resolvePromptTarget } from "@/lib/prompt-targets";
import { SKILL_TRIGGERS, type SkillTrigger } from "@/lib/skills/definitions";
import { listSkills } from "@/lib/skills/store";
import { isVipActive } from "@/lib/pricing";
import { hasAdultAccess } from "@/lib/adult-access";
import { AUTO_MODEL_KEY, canUseModel, listLlmModels } from "@/lib/llm/model-store";

/**
 * 创作端可见的技能清单。
 *
 * 只回展示用的字段——`systemPrompt` / `userTemplate` **一个字都不下发**。
 * 官方技能的提示词是产品资产，下发之后等于公开。用户想要它可以 fork（S3），
 * 那是一条有记录、有归属的路径。
 */
const querySchema = z.object({
  trigger: z.enum(SKILL_TRIGGERS).default("selection"),
  mode: z.enum(GENERATION_MODES).optional(),
  tier: z.enum(GENERATION_TIERS).optional(),
  spicy: z.enum(["true", "false"]).optional(),
});

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "参数无效" }, { status: 400 });
  }
  const q = parsed.data;

  /*
   * formatId 在服务端算，不让前端传：它由 mode/tier/spicy 推出来，
   * 前端自己算一份就多了一处会和服务端对不上的地方。
   */
  const target = q.mode
    ? resolvePromptTarget(q.mode, { tier: q.tier, spicy: q.spicy === "true" })
    : null;

  const skills = await listSkills({
    trigger: q.trigger as SkillTrigger,
    formatId: target?.formatId,
    /* 只带这个人自己的。别人的技能永远不会出现在任何人的菜单里 */
    ownerId: user.id,
  });

  const vipRank = isVipActive(user) ? (user.vipTier?.rank ?? 0) : 0;
  const adultAccess = hasAdultAccess(user);
  const byKey = new Map((await listLlmModels()).map((m) => [m.key, m]));

  /**
   * 用不了绑定的模型就**整条不显示**，而不是显示了点下去再报错。
   *
   * 判的是「技能配成了哪个模型」，不是「这次实际会跑哪个」——后者在成人模式下
   * 会自动切档，拿它判会让一条绑了进阶档的技能对非会员也亮起来。
   *
   * 绑的模型不存在（运营删了、改了 key）时按 auto 处理：一条技能不该因为
   * 某个模型下架就从所有人的菜单里消失。
   */
  const modelAllowed = (modelKey: string) => {
    if (!modelKey || modelKey === AUTO_MODEL_KEY) return true;
    const model = byKey.get(modelKey);
    if (!model) return true;
    return canUseModel(model, { vipRank, adultAccess });
  };

  return NextResponse.json({
    skills: skills
      .filter((s) => s.requiresVipRank <= vipRank && modelAllowed(s.modelKey))
      .map((s) => ({
        key: s.key,
        name: s.name,
        name_en: s.nameEn,
        icon: s.icon,
        description: s.description,
        output_mode: s.outputMode,
        /** 空 = 所有层级。前端按当前章节的标题层级过滤 */
        section_levels: s.sectionLevels,
      })),
  });
}
