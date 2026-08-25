import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { GENERATION_MODES, GENERATION_TIERS } from "@/lib/generation-modes";
import { resolvePromptTarget } from "@/lib/prompt-targets";
import { SKILL_TRIGGERS, type SkillTrigger } from "@/lib/skills/definitions";
import { listSkills } from "@/lib/skills/store";
import { isVipActive } from "@/lib/pricing";

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
  });

  const vipRank = isVipActive(user) ? (user.vipTier?.rank ?? 0) : 0;

  return NextResponse.json({
    skills: skills
      .filter((s) => s.requiresVipRank <= vipRank)
      .map((s) => ({
        key: s.key,
        name: s.name,
        name_en: s.nameEn,
        icon: s.icon,
        description: s.description,
        output_mode: s.outputMode,
      })),
  });
}
