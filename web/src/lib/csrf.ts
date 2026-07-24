import "server-only";
import { env } from "./env";

/**
 * 校验浏览器发起的写操作 Origin，防 CSRF。
 * 无 Origin 时放行（部分同源请求、服务端调用）。
 * 有 Origin 时必须匹配 APP_URL 或当前请求自身 origin。
 */
export function assertSameOrigin(req: Request): { ok: true } | { ok: false; status: number; error: string } {
  const origin = req.headers.get("origin");
  if (!origin) return { ok: true };

  const allowed = new Set<string>();
  try {
    allowed.add(new URL(env.APP_URL).origin);
  } catch {
    /* ignore */
  }
  try {
    allowed.add(new URL(req.url).origin);
  } catch {
    /* ignore */
  }

  if (allowed.size === 0) {
    return { ok: false, status: 500, error: "APP_URL misconfigured" };
  }
  if (!allowed.has(origin)) {
    return { ok: false, status: 403, error: "Invalid origin" };
  }
  return { ok: true };
}
