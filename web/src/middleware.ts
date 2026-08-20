import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  renewSessionToken,
  sessionCookieOptions,
  verifySession,
  type SessionPayload,
} from "@/lib/session-token";

/* middleware 跑在 Edge Runtime，引不了 server-only 模块——
 * 令牌那套逻辑单独放在 lib/session-token.ts，两边共用。 */

const PROTECTED_PAGES = ["/make", "/history", "/profile", "/plaything"];
const PROTECTED_API_PREFIXES = [
  "/api/me",
  "/api/generations",
  "/api/drafts",
  "/api/templates",
  "/api/payments",
  "/api/prompts",
  "/api/features",
  "/api/catalog",
  "/api/plaything",
];
const MOD_PAGE_PREFIX = "/mod";
const MOD_API_PREFIX = "/api/mod";
const ADMIN_PAGE_PREFIX = "/admin";
const ADMIN_API_PREFIX = "/api/admin";
// 无会话即可访问：webhook 靠签名验证；/api/public 为游客接口
const PUBLIC_API = [
  "/api/payments/webhook",
  "/api/payments/crypto/webhook",
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/logout",
  "/api/auth/turnstile",
];

async function getSessionInfo(req: NextRequest): Promise<SessionPayload | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

/**
 * 放行，顺带把登录态的倒计时往后推。
 *
 * 过期时间是「最后一次操作起算」而不是「登录起算」，所以只要还在用就不会掉线；
 * 人真的走开了，两小时后照常过期。绝对上限由 renewSessionToken 把关。
 */
async function pass(session: SessionPayload | null): Promise<NextResponse> {
  const res = NextResponse.next();
  if (!session) return res;
  const renewed = await renewSessionToken(session);
  if (renewed) {
    res.cookies.set(SESSION_COOKIE, renewed.token, sessionCookieOptions(renewed.maxAge));
  }
  return res;
}

function redirectToLogin(req: NextRequest, pathname: string) {
  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export async function middleware(req: NextRequest) {
  // Edge 侧必须有 AUTH_SECRET，否则会话校验无意义
  if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32) {
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Server misconfigured" }, { status: 503 });
    }
  }

  const { pathname } = req.nextUrl;
  // 只解一次令牌，后面的鉴权和续签都复用。放在最前面是为了让浏览公开页面
  // 也算「有操作」——用户在逛画廊，没道理把他判成闲置。
  const session = await getSessionInfo(req);

  if (PUBLIC_API.some((p) => pathname === p) || pathname.startsWith("/api/public/")) {
    return pass(session);
  }

  const isModPage = pathname === MOD_PAGE_PREFIX || pathname.startsWith(`${MOD_PAGE_PREFIX}/`);
  const isModApi = pathname === MOD_API_PREFIX || pathname.startsWith(`${MOD_API_PREFIX}/`);
  const isAdminPage = pathname === ADMIN_PAGE_PREFIX || pathname.startsWith(`${ADMIN_PAGE_PREFIX}/`);
  const isAdminApi = pathname === ADMIN_API_PREFIX || pathname.startsWith(`${ADMIN_API_PREFIX}/`);

  if (isModPage || isModApi || isAdminPage || isAdminApi) {
    const isApi = isModApi || isAdminApi;
    const allowedRoles = isAdminPage || isAdminApi ? ["admin"] : ["moderator", "admin"];
    if (!session) {
      return isApi ? NextResponse.json({ error: "Unauthorized" }, { status: 401 }) : redirectToLogin(req, pathname);
    }
    if (!allowedRoles.includes(session.role)) {
      return isApi
        ? NextResponse.json({ error: "Forbidden" }, { status: 403 })
        : NextResponse.redirect(new URL("/", req.url));
    }
    return pass(session);
  }

  const isProtectedPage = PROTECTED_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const isProtectedApi = PROTECTED_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!isProtectedPage && !isProtectedApi) {
    return pass(session);
  }

  if (session) {
    return pass(session);
  }

  if (isProtectedApi) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return redirectToLogin(req, pathname);
}

export const config = {
  matcher: [
    "/make/:path*",
    "/history/:path*",
    "/profile/:path*",
    "/plaything/:path*",
    "/make",
    "/history",
    "/profile",
    "/plaything",
    "/mod",
    "/mod/:path*",
    "/admin",
    "/admin/:path*",
    "/api/:path*",
  ],
};
