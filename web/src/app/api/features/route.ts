import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hfConfigured } from "@/lib/hf";
import { hasPlaythingAccess } from "@/lib/plaything-access";
import { promptOptimizerConfigured } from "@/lib/prompt-optimizer";

/** 登录用户可见的功能开关（不含密钥） */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json({
    magic_prompt: await hfConfigured(),
    plaything: hasPlaythingAccess(user),
    // 只在玩物专区提供；创作中心的魔法指令继续走 magic_prompt（HF）
    plaything_prompt_optimizer: await promptOptimizerConfigured(),
  });
}
