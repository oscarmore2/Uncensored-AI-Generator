import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { credentialsSchema } from "@/lib/validators";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { userOut } from "@/lib/serialize";
import { sendTelegram } from "@/lib/telegram";
import { assertSameOrigin } from "@/lib/csrf";
import { extractTurnstileToken, verifyTurnstileToken } from "@/lib/turnstile";
import { LEGAL_VERSION } from "@/lib/legal";
import {
  emailDeliveryConfigured,
  normalizeEmail,
  sendVerificationEmail,
} from "@/lib/email-verification";
import { getSignupInitialCredits } from "@/lib/signup-settings";
import {
  detectRegistrationGeo,
  registrationGeoData,
} from "@/lib/registration-geo";

const RESERVED = new Set(["demo_user", "mod_user", "admin_user", "admin", "root", "system"]);

const registerBodySchema = credentialsSchema.and(
  z.object({
    email: z.string().email("请输入有效邮箱").max(254),
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
    return NextResponse.json({ error: "请求过于频繁，请稍后再试", code: "RATE_LIMITED" }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = registerBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message, code: "INVALID_REGISTRATION" },
      { status: 400 }
    );
  }

  const captcha = await verifyTurnstileToken(extractTurnstileToken(parsed.data), ip);
  if (!captcha.ok) {
    return NextResponse.json({ error: captcha.error }, { status: captcha.status });
  }

  if (!emailDeliveryConfigured()) {
    return NextResponse.json(
      { error: "邮箱验证服务尚未配置", code: "EMAIL_SERVICE_UNAVAILABLE" },
      { status: 503 }
    );
  }

  const { username, password } = parsed.data;
  const email = normalizeEmail(parsed.data.email);
  const seedName = process.env.SEED_ADMIN_USERNAME?.trim();
  if (RESERVED.has(username) || (seedName && username === seedName)) {
    return NextResponse.json({ error: "该用户名不可用", code: "USERNAME_UNAVAILABLE" }, { status: 400 });
  }

  const existing = await db.user.findFirst({
    where: { OR: [{ username }, { email }] },
    select: { email: true, emailVerifiedAt: true },
  });
  if (existing) {
    return NextResponse.json(
      {
        error: "用户名或邮箱不可用",
        code:
          existing.email === email && !existing.emailVerifiedAt
            ? "EMAIL_ALREADY_PENDING"
            : "IDENTITY_UNAVAILABLE",
      },
      { status: 400 }
    );
  }

  const [initialCredits, registrationGeo] = await Promise.all([
    getSignupInitialCredits(),
    detectRegistrationGeo(req),
  ]);
  const user = await db.user.create({
    data: {
      username,
      hashedPassword: await hashPassword(password),
      email,
      balance: initialCredits,
      ...registrationGeoData(registrationGeo),
      acceptedTermsAt: new Date(),
      termsVersion: LEGAL_VERSION,
      transactions:
        initialCredits > 0
          ? {
              create: {
                type: "signup_bonus",
                amount: initialCredits,
                method: "registration",
              },
            }
          : undefined,
    },
  });
  void sendTelegram(`🆕 新用户注册（待邮箱验证）: ${user.username} (ID ${user.id})`);

  try {
    const delivery = await sendVerificationEmail({
      userId: user.id,
      email,
      username: user.username,
    });
    return NextResponse.json(
      {
        user: userOut(user),
        verification_required: true,
        email,
        ...delivery,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[register] verification email failed", error);
    return NextResponse.json(
      {
        error: "账户已创建，但验证邮件发送失败，请稍后重发",
        code: "EMAIL_SEND_FAILED",
        verification_required: true,
        email,
      },
      { status: 502 }
    );
  }
}
