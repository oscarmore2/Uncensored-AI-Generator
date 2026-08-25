import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { llmConfigured } from "@/lib/llm/chat";
import { hasSkillAuthoring } from "@/lib/skills/access";
import { hasPlaythingAccess } from "@/lib/plaything-access";
import { promptOptimizerConfigured } from "@/lib/prompt-optimizer";

/** 登录用户可见的功能开关（不含密钥） */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json({
    /*
     * 选区级 AI 与魔法指令现在是**同一条线**（技能系统），所以只有一个开关。
     * 具体某个时机下有没有按钮，由 /api/skills 的技能清单决定——
     * 管理端把技能全停用了，开关是开的但菜单是空的。
     */
    ai_text: await llmConfigured(),
    plaything: hasPlaythingAccess(user),
    /* 能不能自建技能。与 VIP 分开的一位，见 skills/access.ts */
    skill_authoring: hasSkillAuthoring(user),
    // 只在玩物专区提供；与创作中心的技能系统是两条独立链路，互不替代
    plaything_prompt_optimizer: await promptOptimizerConfigured(),
  });
}
