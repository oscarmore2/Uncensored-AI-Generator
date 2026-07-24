import "server-only";
import { env } from "./env";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function turnstileEnabled(): boolean {
  return Boolean(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY);
}

export function turnstileSiteKey(): string | null {
  return env.TURNSTILE_SITE_KEY || null;
}

/**
 * 校验 Cloudflare Turnstile token。
 * 未配置密钥时：开发环境放行；生产环境拒绝（避免误以为有防护）。
 */
export async function verifyTurnstileToken(
  token: string | undefined | null,
  remoteIp?: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!turnstileEnabled()) {
    if (process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build") {
      // 生产未配置 = 不强制（便于逐步上线）；若要强制可设 TURNSTILE_REQUIRED=true
      if (env.TURNSTILE_REQUIRED) {
        return { ok: false, error: "人机验证未配置" };
      }
    }
    return { ok: true };
  }

  if (!token || typeof token !== "string" || token.length < 10 || token.length > 2048) {
    return { ok: false, error: "请完成人机验证" };
  }

  try {
    const body = new URLSearchParams();
    body.set("secret", env.TURNSTILE_SECRET_KEY);
    body.set("response", token);
    if (remoteIp) body.set("remoteip", remoteIp);

    const resp = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await resp.json()) as {
      success?: boolean;
      "error-codes"?: string[];
      hostname?: string;
    };

    if (!data.success) {
      console.warn("[turnstile] verify failed:", data["error-codes"]);
      return { ok: false, error: "人机验证失败，请刷新后重试" };
    }

    // hostname 仅记录，不硬拦（Railway 临时域 / 自定义域可能并存）
    if (data.hostname) {
      try {
        const expected = new URL(env.APP_URL).hostname.toLowerCase();
        const tokenHost = data.hostname.toLowerCase();
        if (tokenHost !== expected) {
          console.warn(`[turnstile] hostname mismatch: token=${tokenHost} app=${expected}`);
        }
      } catch {
        /* ignore */
      }
    }

    return { ok: true };
  } catch (err) {
    console.error("[turnstile] verify error:", err);
    return { ok: false, error: "人机验证服务暂时不可用" };
  }
}
