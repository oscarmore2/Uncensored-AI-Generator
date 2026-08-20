import "server-only";
import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  sessionCookieOptions,
  signSession,
  verifySession,
  type SessionPayload,
} from "./session-token";

/* 签发/校验逻辑在 session-token.ts——middleware 跑在 Edge 上，引不了 server-only。
 * 这里只负责跟 cookie store 打交道。 */
export {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  SESSION_ABSOLUTE_MAX_SECONDS,
  sessionCookieOptions,
  signSession,
  verifySession,
  renewSessionToken,
  type SessionPayload,
  type SessionClaims,
} from "./session-token";

export async function createSessionCookie(userId: number, username: string, role = "user") {
  const token = await signSession({ sub: String(userId), username, role });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, sessionCookieOptions());
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}
