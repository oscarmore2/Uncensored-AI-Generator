import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const SESSION_COOKIE = "avclubs_session";

// middleware 运行在 Edge Runtime，不能引用 server-only 模块，密钥直接从环境读取
const secret = new TextEncoder().encode(process.env.AUTH_SECRET ?? "");

const PROTECTED_PAGES = ["/make", "/history", "/profile", "/plaything"];
const PROTECTED_API_PREFIXES = [
  "/api/me",
  "/api/generations",
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
  "/api/zen/webhook",
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/logout",
  "/api/auth/turnstile",
];

interface SessionInfo {
  role: string;
}

async function getSessionInfo(req: NextRequest): Promise<SessionInfo | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    return { role: String(payload.role ?? "user") };
  } catch {
    return null;
  }
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

  if (PUBLIC_API.some((p) => pathname === p) || pathname.startsWith("/api/public/")) {
    return NextResponse.next();
  }

  const isModPage = pathname === MOD_PAGE_PREFIX || pathname.startsWith(`${MOD_PAGE_PREFIX}/`);
  const isModApi = pathname === MOD_API_PREFIX || pathname.startsWith(`${MOD_API_PREFIX}/`);
  const isAdminPage = pathname === ADMIN_PAGE_PREFIX || pathname.startsWith(`${ADMIN_PAGE_PREFIX}/`);
  const isAdminApi = pathname === ADMIN_API_PREFIX || pathname.startsWith(`${ADMIN_API_PREFIX}/`);

  if (isModPage || isModApi || isAdminPage || isAdminApi) {
    const isApi = isModApi || isAdminApi;
    const allowedRoles = isAdminPage || isAdminApi ? ["admin"] : ["moderator", "admin"];
    const session = await getSessionInfo(req);
    if (!session) {
      return isApi ? NextResponse.json({ error: "Unauthorized" }, { status: 401 }) : redirectToLogin(req, pathname);
    }
    if (!allowedRoles.includes(session.role)) {
      return isApi
        ? NextResponse.json({ error: "Forbidden" }, { status: 403 })
        : NextResponse.redirect(new URL("/", req.url));
    }
    return NextResponse.next();
  }

  const isProtectedPage = PROTECTED_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const isProtectedApi = PROTECTED_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!isProtectedPage && !isProtectedApi) {
    return NextResponse.next();
  }

  if (await getSessionInfo(req)) {
    return NextResponse.next();
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
