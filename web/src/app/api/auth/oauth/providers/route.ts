import { NextResponse } from "next/server";
import { oauthProviderConfigured } from "@/lib/oauth";

export async function GET() {
  return NextResponse.json({
    google: oauthProviderConfigured("google"),
    facebook: oauthProviderConfigured("facebook"),
  });
}
