import { NextResponse } from "next/server";
import { turnstileEnabled, turnstileSiteKey } from "@/lib/turnstile";

/** Public: site key for the login widget (secret never exposed). */
export async function GET() {
  return NextResponse.json({
    enabled: turnstileEnabled(),
    site_key: turnstileSiteKey(),
  });
}
