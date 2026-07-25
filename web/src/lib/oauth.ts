import "server-only";
import crypto from "crypto";
import { z } from "zod";
import { db } from "./db";
import { env } from "./env";
import { normalizeEmail } from "./email-verification";
import { LEGAL_VERSION } from "./legal";
import type { OAuthProvider } from "./oauth-flow";
import type { RegistrationGeo } from "./registration-geo";
import { registrationGeoData } from "./registration-geo";
import { getSignupInitialCredits } from "./signup-settings";

interface OAuthProfile {
  provider: OAuthProvider;
  providerAccountId: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  avatarUrl: string | null;
}

export class OAuthLoginError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

function configured(provider: OAuthProvider): boolean {
  return provider === "google"
    ? Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
    : Boolean(env.FACEBOOK_APP_ID && env.FACEBOOK_APP_SECRET);
}

export function oauthProviderConfigured(provider: OAuthProvider): boolean {
  return configured(provider);
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: { message?: string };
    error_description?: string;
  };
  if (!response.ok) {
    throw new OAuthLoginError(
      data.error_description ?? data.error?.message ?? "provider_request_failed"
    );
  }
  return data;
}

export async function fetchGoogleProfile(params: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<OAuthProfile> {
  const token = await fetchJson<{ access_token?: string }>(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: params.code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: params.redirectUri,
        grant_type: "authorization_code",
        code_verifier: params.codeVerifier,
      }),
    }
  );
  if (!token.access_token) throw new OAuthLoginError("missing_access_token");

  const profile = await fetchJson<{
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
  }>("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!profile.sub || !profile.email || profile.email_verified !== true) {
    throw new OAuthLoginError("verified_email_required");
  }
  return {
    provider: "google",
    providerAccountId: profile.sub,
    email: profile.email,
    emailVerified: true,
    name: profile.name?.trim() || null,
    avatarUrl: profile.picture ?? null,
  };
}

export async function fetchFacebookProfile(params: {
  code: string;
  redirectUri: string;
}): Promise<OAuthProfile> {
  const version = env.FACEBOOK_GRAPH_VERSION;
  const tokenUrl = new URL(`https://graph.facebook.com/${version}/oauth/access_token`);
  tokenUrl.searchParams.set("client_id", env.FACEBOOK_APP_ID);
  tokenUrl.searchParams.set("client_secret", env.FACEBOOK_APP_SECRET);
  tokenUrl.searchParams.set("redirect_uri", params.redirectUri);
  tokenUrl.searchParams.set("code", params.code);
  const token = await fetchJson<{ access_token?: string }>(tokenUrl.toString());
  if (!token.access_token) throw new OAuthLoginError("missing_access_token");

  const proof = crypto
    .createHmac("sha256", env.FACEBOOK_APP_SECRET)
    .update(token.access_token)
    .digest("hex");
  const profileUrl = new URL(`https://graph.facebook.com/${version}/me`);
  profileUrl.searchParams.set("fields", "id,name,email,picture.type(large)");
  profileUrl.searchParams.set("access_token", token.access_token);
  profileUrl.searchParams.set("appsecret_proof", proof);
  const profile = await fetchJson<{
    id?: string;
    name?: string;
    email?: string;
    picture?: { data?: { url?: string } };
  }>(profileUrl.toString());
  if (!profile.id || !profile.email) {
    throw new OAuthLoginError("verified_email_required");
  }
  return {
    provider: "facebook",
    providerAccountId: profile.id,
    email: profile.email,
    emailVerified: true,
    name: profile.name?.trim() || null,
    avatarUrl: profile.picture?.data?.url ?? null,
  };
}

async function uniqueUsername(profile: OAuthProfile): Promise<string> {
  const local = profile.email.split("@")[0] ?? "";
  const source = profile.name || local || `${profile.provider}_user`;
  let base = source
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 22);
  if (base.length < 3) base = `${profile.provider}_user`;

  for (let attempt = 0; attempt < 20; attempt++) {
    const suffix = attempt === 0 ? "" : `_${crypto.randomBytes(3).toString("hex")}`;
    const candidate = `${base.slice(0, 32 - suffix.length)}${suffix}`;
    if (!(await db.user.findUnique({ where: { username: candidate }, select: { id: true } }))) {
      return candidate;
    }
  }
  return `${profile.provider}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export async function resolveOAuthUser(
  profile: OAuthProfile,
  registrationGeo: RegistrationGeo | null = null
) {
  const parsedEmail = z.string().email().safeParse(normalizeEmail(profile.email));
  if (!parsedEmail.success || !profile.emailVerified) {
    throw new OAuthLoginError("verified_email_required");
  }
  const email = parsedEmail.data;
  const linked = await db.oAuthAccount.findUnique({
    where: {
      provider_providerAccountId: {
        provider: profile.provider,
        providerAccountId: profile.providerAccountId,
      },
    },
    include: { user: true },
  });
  if (linked) {
    if (linked.user.disabledAt) throw new OAuthLoginError("account_disabled");
    return db.user.update({
      where: { id: linked.user.id },
      data: {
        displayName: profile.name ?? linked.user.displayName,
        avatarUrl: profile.avatarUrl ?? linked.user.avatarUrl,
        acceptedTermsAt:
          linked.user.termsVersion === LEGAL_VERSION ? undefined : new Date(),
        termsVersion: LEGAL_VERSION,
      },
    });
  }

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.disabledAt) throw new OAuthLoginError("account_disabled");
    // Google 明确返回 email_verified，可安全绑定同邮箱；Facebook 没有等价声明，
    // 不自动合并，避免仅凭邮箱造成账号接管。
    if (profile.provider !== "google") {
      throw new OAuthLoginError("email_already_registered");
    }
    return db.user.update({
      where: { id: existing.id },
      data: {
        emailVerifiedAt: existing.emailVerifiedAt ?? new Date(),
        displayName: profile.name ?? existing.displayName,
        avatarUrl: profile.avatarUrl ?? existing.avatarUrl,
        acceptedTermsAt:
          existing.termsVersion === LEGAL_VERSION ? undefined : new Date(),
        termsVersion: LEGAL_VERSION,
        oauthAccounts: {
          create: {
            provider: profile.provider,
            providerAccountId: profile.providerAccountId,
            providerEmail: email,
          },
        },
      },
    });
  }

  const username = await uniqueUsername(profile);
  const initialCredits = await getSignupInitialCredits();
  return db.user.create({
    data: {
      username,
      hashedPassword: null,
      email,
      emailVerifiedAt: new Date(),
      displayName: profile.name,
      avatarUrl: profile.avatarUrl,
      balance: initialCredits,
      ...registrationGeoData(registrationGeo),
      acceptedTermsAt: new Date(),
      termsVersion: LEGAL_VERSION,
      transactions:
        initialCredits > 0
          ? {
              create: {
                type: "signup_bonus",
                amount: initialCredits,
                method: `oauth:${profile.provider}`,
              },
            }
          : undefined,
      oauthAccounts: {
        create: {
          provider: profile.provider,
          providerAccountId: profile.providerAccountId,
          providerEmail: email,
        },
      },
    },
  });
}
