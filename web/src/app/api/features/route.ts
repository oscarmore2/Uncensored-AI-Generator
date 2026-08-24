import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hfConfigured } from "@/lib/hf";
import { llmConfigured } from "@/lib/llm/chat";
import { hasPlaythingAccess } from "@/lib/plaything-access";
import { promptOptimizerConfigured } from "@/lib/prompt-optimizer";

/** 登录用户可见的功能开关（不含密钥） */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json({
    magic_prompt: await hfConfigured(),
    /*
     * 选区级 AI 走的是文本 LLM 那条线（OpenRouter，没配就退回 HF），
     * 与魔法指令**不是同一个开关**——只配了 OpenRouter 时魔法指令还没迁过来，
     * 但选区级 AI 已经能用了。
     */
    selection_ai: await llmConfigured(),
    plaything: hasPlaythingAccess(user),
    // 只在玩物专区提供；创作中心的魔法指令继续走 magic_prompt（HF）
    plaything_prompt_optimizer: await promptOptimizerConfigured(),
  });
}
