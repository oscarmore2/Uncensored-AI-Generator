import "server-only";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Public site key for the existing Cloudflare widget (safe to embed in frontend). */
export const TURNSTILE_SITEKEY = "0x4AAAAAAD8kZKnkc2ervQg4";

export function turnstileSecret(): string {
  return (process.env.TURNSTILE_SECRET ?? "").trim();
}

export function turnstileEnabled(): boolean {
  return Boolean(turnstileSecret());
}

/**
 * Canonical Turnstile siteverify.
 * Uses TURNSTILE_SECRET from the environment — never hard-code the secret.
 */
export async function verifyTurnstileToken(
  token: string | undefined | null,
  remoteIp?: string | null
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const secret = turnstileSecret();
  if (!secret) {
    // Secret not configured yet — refuse in production so bots cannot bypass.
    if (process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build") {
      return { ok: false, status: 503, error: "Turnstile is not configured" };
    }
    return { ok: true };
  }

  if (!token || typeof token !== "string" || token.length < 10 || token.length > 2048) {
    return { ok: false, status: 403, error: "forbidden" };
  }

  try {
    const body = new URLSearchParams({
      secret,
      response: token,
    });
    if (remoteIp && remoteIp !== "unknown") {
      body.set("remoteip", remoteIp);
    }

    const resp = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const result = (await resp.json()) as { success?: boolean; "error-codes"?: string[] };

    if (result.success !== true) {
      console.warn("[turnstile] siteverify failed:", result["error-codes"]);
      return { ok: false, status: 403, error: "forbidden" };
    }
    return { ok: true };
  } catch (err) {
    console.error("[turnstile] siteverify error:", err);
    return { ok: false, status: 403, error: "forbidden" };
  }
}

/** Prefer Spin field name; accept our JSON alias. */
export function extractTurnstileToken(body: Record<string, unknown> | null): string | undefined {
  if (!body) return undefined;
  const a = body["cf-turnstile-response"];
  const b = body["turnstile_token"];
  if (typeof a === "string") return a;
  if (typeof b === "string") return b;
  return undefined;
}
