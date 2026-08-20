import { SignJWT, jwtVerify } from "jose";

/**
 * 会话令牌的签发与校验。**不碰 cookie**，所以 Edge Runtime 也能用——
 * middleware 要在这里续签。读写 cookie 的部分在 session.ts。
 *
 * 过期策略是「闲置过期 + 绝对上限」，不是从登录起算的硬性两小时：
 * - 有操作就顺延 SESSION_TTL_SECONDS，见 renewSessionToken
 * - 但从登录那一刻起最多续到 SESSION_ABSOLUTE_MAX_SECONDS，到点必须重新登录
 *
 * 没有上限的话，令牌一旦泄露就能靠自动续签一直活着，闲置过期也就白设了。
 */

export const SESSION_COOKIE = "avclubs_session";

/** 多久没操作就掉线 */
export const SESSION_TTL_SECONDS = 2 * 60 * 60; // 2h

/** 登录起算的绝对寿命，不看活跃度 */
export const SESSION_ABSOLUTE_MAX_SECONDS = 30 * 24 * 60 * 60; // 30d

/**
 * 距上次签发超过这个时长才续。
 * 不是每个请求都重签：那样每个响应都挂一个 Set-Cookie，白费带宽还会干扰缓存。
 */
export const SESSION_RENEW_AFTER_SECONDS = 15 * 60; // 15min

/** 惰性取密钥：构建期 AUTH_SECRET 可能还不在，模块顶层算会炸 */
let cachedSecret: Uint8Array | null = null;
function secret(): Uint8Array {
  if (!cachedSecret) cachedSecret = new TextEncoder().encode(process.env.AUTH_SECRET ?? "");
  return cachedSecret;
}

export interface SessionClaims {
  sub: string; // user id
  username: string;
  role: string;
}

export interface SessionPayload extends SessionClaims {
  /** 本次登录的起点（秒）。续签时原样带走，用来卡绝对上限 */
  startedAt: number;
  /** 本次签发时间（秒），判断该不该续签用 */
  issuedAt: number;
}

export function sessionCookieOptions(maxAge: number = SESSION_TTL_SECONDS) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

export async function signSession(
  claims: SessionClaims & { startedAt?: number },
  ttlSeconds: number = SESSION_TTL_SECONDS
): Promise<string> {
  const startedAt = claims.startedAt ?? Math.floor(Date.now() / 1000);
  return new SignJWT({ username: claims.username, role: claims.role, sst: startedAt })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secret());
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (!payload.sub) return null;
    const issuedAt = typeof payload.iat === "number" ? payload.iat : 0;
    const sst = payload.sst;
    return {
      sub: payload.sub,
      username: String(payload.username ?? ""),
      role: String(payload.role ?? "user"),
      // 续签上线前签发的令牌没有 sst，用 iat 顶上。它们最多只剩两小时寿命，
      // 绝对上限怎么算都轮不到它先到期，所以不会把老用户踢下线。
      startedAt: typeof sst === "number" ? sst : issuedAt,
      issuedAt,
    };
  } catch {
    return null;
  }
}

/**
 * 该续就续，返回新令牌；不该续返回 null（调用方原样放行，旧令牌还没到期）。
 *
 * 快到绝对上限时把 TTL 截断，让「登录起 30 天」是句实话而不是约数。
 */
export async function renewSessionToken(
  session: SessionPayload,
  now: number = Math.floor(Date.now() / 1000)
): Promise<{ token: string; maxAge: number } | null> {
  if (now - session.issuedAt < SESSION_RENEW_AFTER_SECONDS) return null;
  const budget = session.startedAt + SESSION_ABSOLUTE_MAX_SECONDS - now;
  if (budget <= 0) return null;
  const ttl = Math.min(SESSION_TTL_SECONDS, budget);
  return { token: await signSession({ ...session, startedAt: session.startedAt }, ttl), maxAge: ttl };
}
