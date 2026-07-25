import "server-only";
import crypto from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { env } from "./env";

export const OAUTH_FLOW_COOKIE = "oauth_flow";
export type OAuthProvider = "google" | "facebook";

interface OAuthFlow {
  provider: OAuthProvider;
  state: string;
  next: string;
  codeVerifier?: string;
}

const secret = new TextEncoder().encode(env.AUTH_SECRET);

export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return "/make";
  const path = raw.trim();
  if (!/^\/(?!\/)/.test(path)) return "/make";
  if (path.includes("://") || path.includes("\\") || path.length > 512) return "/make";
  return path;
}

export function randomBase64Url(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function pkceChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

export async function signOAuthFlow(flow: OAuthFlow): Promise<string> {
  return new SignJWT({ ...flow })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .setAudience("oauth-flow")
    .sign(secret);
}

export async function verifyOAuthFlow(token: string): Promise<OAuthFlow | null> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
      audience: "oauth-flow",
    });
    if (
      (payload.provider !== "google" && payload.provider !== "facebook") ||
      typeof payload.state !== "string" ||
      typeof payload.next !== "string"
    ) {
      return null;
    }
    return {
      provider: payload.provider,
      state: payload.state,
      next: safeNextPath(payload.next),
      codeVerifier:
        typeof payload.codeVerifier === "string" ? payload.codeVerifier : undefined,
    };
  } catch {
    return null;
  }
}
