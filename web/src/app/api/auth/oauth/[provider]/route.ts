import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { absoluteUrl } from "@/lib/site";
import { oauthProviderConfigured } from "@/lib/oauth";
import {
  OAUTH_FLOW_COOKIE,
  type OAuthProvider,
  pkceChallenge,
  randomBase64Url,
  safeNextPath,
  signOAuthFlow,
} from "@/lib/oauth-flow";

function parseProvider(value: string): OAuthProvider | null {
  return value === "google" || value === "facebook" ? value : null;
}

export async function GET(
  req: Request,
  context: { params: Promise<{ provider: string }> }
) {
  const provider = parseProvider((await context.params).provider);
  if (!provider) return NextResponse.json({ error: "Unknown provider" }, { status: 404 });

  const loginUrl = new URL("/login", req.url);
  if (!oauthProviderConfigured(provider)) {
    loginUrl.searchParams.set("oauth_error", "not_configured");
    return NextResponse.redirect(loginUrl);
  }

  const state = randomBase64Url();
  const next = safeNextPath(new URL(req.url).searchParams.get("next"));
  const codeVerifier = provider === "google" ? randomBase64Url(48) : undefined;
  const redirectUri = absoluteUrl(`/api/auth/oauth/${provider}/callback`);
  let authorizationUrl: URL;

  if (provider === "google") {
    authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorizationUrl.search = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid profile email",
      state,
      prompt: "select_account",
      code_challenge: pkceChallenge(codeVerifier!),
      code_challenge_method: "S256",
    }).toString();
  } else {
    const version = env.FACEBOOK_GRAPH_VERSION;
    authorizationUrl = new URL(`https://www.facebook.com/${version}/dialog/oauth`);
    authorizationUrl.search = new URLSearchParams({
      client_id: env.FACEBOOK_APP_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "public_profile,email",
      state,
    }).toString();
  }

  const flowToken = await signOAuthFlow({ provider, state, next, codeVerifier });
  const response = NextResponse.redirect(authorizationUrl);
  response.cookies.set(OAUTH_FLOW_COOKIE, flowToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/oauth",
    maxAge: 10 * 60,
  });
  return response;
}
