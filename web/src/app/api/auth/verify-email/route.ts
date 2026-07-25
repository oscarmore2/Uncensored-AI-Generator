import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashVerificationToken } from "@/lib/email-verification";
import {
  SESSION_COOKIE,
  sessionCookieOptions,
  signSession,
} from "@/lib/session";

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  const loginUrl = new URL("/login", req.url);
  if (!token || token.length > 256) {
    loginUrl.searchParams.set("verify_error", "invalid");
    return NextResponse.redirect(loginUrl);
  }

  const record = await db.emailVerificationToken.findUnique({
    where: { tokenHash: hashVerificationToken(token) },
    include: { user: true },
  });
  if (
    !record ||
    record.consumedAt ||
    record.expiresAt.getTime() <= Date.now() ||
    record.user.disabledAt
  ) {
    loginUrl.searchParams.set("verify_error", "invalid_or_expired");
    return NextResponse.redirect(loginUrl);
  }

  const verifiedAt = new Date();
  const claimed = await db.$transaction(async (tx) => {
    const result = await tx.emailVerificationToken.updateMany({
      where: {
        id: record.id,
        consumedAt: null,
        expiresAt: { gt: verifiedAt },
      },
      data: { consumedAt: verifiedAt },
    });
    if (result.count === 0) return false;
    const userResult = await tx.user.updateMany({
      where: { id: record.userId, disabledAt: null },
      data: { emailVerifiedAt: verifiedAt },
    });
    return userResult.count === 1;
  });
  if (!claimed) {
    loginUrl.searchParams.set("verify_error", "invalid_or_expired");
    return NextResponse.redirect(loginUrl);
  }

  const tokenValue = await signSession({
    sub: String(record.user.id),
    username: record.user.username,
    role: record.user.role,
  });
  const response = NextResponse.redirect(new URL("/make?email_verified=1", req.url));
  response.cookies.set(SESSION_COOKIE, tokenValue, sessionCookieOptions());
  return response;
}
