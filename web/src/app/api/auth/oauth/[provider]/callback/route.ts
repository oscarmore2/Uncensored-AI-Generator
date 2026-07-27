import { NextRequest, NextResponse } from "next/server";
import { absoluteUrl } from "@/lib/site";
import {
  fetchFacebookProfile,
  fetchGoogleProfile,
  OAuthLoginError,
  resolveOAuthUser,
} from "@/lib/oauth";
import {
  OAUTH_FLOW_COOKIE,
  type OAuthProvider,
  verifyOAuthFlow,
} from "@/lib/oauth-flow";
import {
  SESSION_COOKIE,
  sessionCookieOptions,
  signSession,
} from "@/lib/session";
import { sendTelegram } from "@/lib/telegram";
import { detectRegistrationGeo } from "@/lib/registration-geo";

function parseProvider(value: string): OAuthProvider | null {
  return value === "google" || value === "facebook" ? value : null;
}

/**
 * 一律基于 APP_URL 构造回跳地址。
 * 反代后 req.url 的 host 是容器内部地址（localhost:3000），
 * 且不认 X-Forwarded-Host，直接用它会把用户踢到本机地址。
 */
function errorRedirect(code: string) {
  const url = new URL(absoluteUrl("/login"));
  url.searchParams.set("oauth_error", code);
  return url;
}

const PUBLIC_OAUTH_ERRORS = new Set([
  "verified_email_required",
  "email_already_registered",
  "account_disabled",
]);

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ provider: string }> }
) {
  const provider = parseProvider((await context.params).provider);
  if (!provider) return NextResponse.json({ error: "Unknown provider" }, { status: 404 });

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const providerError = url.searchParams.get("error");
  const flowCookie = req.cookies.get(OAUTH_FLOW_COOKIE)?.value;
  const flow = flowCookie ? await verifyOAuthFlow(flowCookie) : null;

  let destination: URL;
  let sessionToken: string | null = null;
  if (providerError === "access_denied") {
    destination = errorRedirect("access_denied");
  } else if (!flow || flow.provider !== provider || !state || flow.state !== state || !code) {
    destination = errorRedirect("invalid_state");
  } else {
    try {
      const redirectUri = absoluteUrl(`/api/auth/oauth/${provider}/callback`);
      const profile =
        provider === "google"
          ? await fetchGoogleProfile({
              code,
              codeVerifier: flow.codeVerifier ?? "",
              redirectUri,
            })
          : await fetchFacebookProfile({ code, redirectUri });
      const existingAccount = await import("@/lib/db").then(({ db }) =>
        db.oAuthAccount.findUnique({
          where: {
            provider_providerAccountId: {
              provider,
              providerAccountId: profile.providerAccountId,
            },
          },
          select: { id: true },
        })
      );
      const registrationGeo = existingAccount ? null : await detectRegistrationGeo(req);
      const user = await resolveOAuthUser(profile, registrationGeo);
      if (!existingAccount) {
        void sendTelegram(`🆕 OAuth 用户注册: ${user.username} (${provider}, ID ${user.id})`);
      }
      sessionToken = await signSession({
        sub: String(user.id),
        username: user.username,
        role: user.role,
      });
      destination = new URL(absoluteUrl(flow.next));
    } catch (error) {
      console.error(`[oauth:${provider}] callback failed`, error);
      destination = errorRedirect(
        error instanceof OAuthLoginError && PUBLIC_OAUTH_ERRORS.has(error.code)
          ? error.code
          : "provider_failed"
      );
    }
  }

  const response = NextResponse.redirect(destination);
  if (sessionToken) {
    response.cookies.set(SESSION_COOKIE, sessionToken, sessionCookieOptions());
  }
  response.cookies.set(OAUTH_FLOW_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/oauth",
    maxAge: 0,
  });
  return response;
}
