import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { createSessionCookie } from "@/lib/session";
import { credentialsSchema } from "@/lib/validators";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { userOut } from "@/lib/serialize";
import { sendTelegram } from "@/lib/telegram";
import { assertSameOrigin } from "@/lib/csrf";
import { extractTurnstileToken, verifyTurnstileToken } from "@/lib/turnstile";
import { LEGAL_VERSION } from "@/lib/legal";

const RESERVED = new Set(["demo_user", "mod_user", "admin_user", "admin", "root", "system"]);

const registerBodySchema = credentialsSchema.and(
  z.object({
    turnstile_token: z.string().min(1).max(2048).optional(),
    "cf-turnstile-response": z.string().min(1).max(2048).optional(),
    accepted_terms: z.literal(true, { errorMap: () => ({ message: "请先同意用户条款与内容使用条款" }) }),
  })
);

export async function POST(req: Request) {
  const originCheck = assertSameOrigin(req);
  if (!originCheck.ok) {
    return NextResponse.json({ error: originCheck.error }, { status: originCheck.status });
  }

  const ip = clientIp(req);
  if (!rateLimit(`register:${ip}`, 5, 60_000)) {
    return NextResponse.json({ error: "请求过于频繁，请稍后再试" }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = registerBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const captcha = await verifyTurnstileToken(extractTurnstileToken(parsed.data), ip);
  if (!captcha.ok) {
    return NextResponse.json({ error: captcha.error }, { status: captcha.status });
  }

  const { username, password } = parsed.data;
  const seedName = process.env.SEED_ADMIN_USERNAME?.trim();
  if (RESERVED.has(username) || (seedName && username === seedName)) {
    return NextResponse.json({ error: "该用户名不可用" }, { status: 400 });
  }

  const existing = await db.user.findUnique({ where: { username } });
  if (existing) {
    return NextResponse.json({ error: "该用户名不可用" }, { status: 400 });
  }

  const user = await db.user.create({
    data: {
      username,
      hashedPassword: await hashPassword(password),
      acceptedTermsAt: new Date(),
      termsVersion: LEGAL_VERSION,
    },
  });
  sendTelegram(`🆕 新用户注册: ${user.username} (ID ${user.id})`);

  await createSessionCookie(user.id, user.username, user.role);
  return NextResponse.json(userOut(user), { status: 201 });
}
