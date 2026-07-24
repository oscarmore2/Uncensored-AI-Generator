import { NextResponse } from "next/server";
import { TURNSTILE_SITEKEY, turnstileEnabled } from "@/lib/turnstile";

/** Public: site key for the login widget (secret never exposed). */
export async function GET() {
  return NextResponse.json({
    enabled: turnstileEnabled(),
    site_key: TURNSTILE_SITEKEY,
  });
}
