import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hfConfigured } from "@/lib/hf";

/** 登录用户可见的功能开关（不含密钥） */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json({
    magic_prompt: await hfConfigured(),
  });
}
