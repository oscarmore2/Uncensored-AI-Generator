import { NextResponse } from "next/server";
import { turnstileEnabled, turnstileSiteKey } from "@/lib/turnstile";

/** 公开：登录页获取 Turnstile site key（不含 secret） */
export async function GET() {
  const enabled = turnstileEnabled();
  return NextResponse.json({
    enabled,
    site_key: enabled ? turnstileSiteKey() : null,
  });
}
