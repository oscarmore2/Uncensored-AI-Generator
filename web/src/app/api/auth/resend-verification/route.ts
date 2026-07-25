import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  emailDeliveryConfigured,
  hashVerificationToken,
  normalizeEmail,
  sendVerificationEmail,
} from "@/lib/email-verification";
import { assertSameOrigin } from "@/lib/csrf";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const schema = z.object({ email: z.string().email().max(254) });

export async function POST(req: Request) {
  const originCheck = assertSameOrigin(req);
  if (!originCheck.ok) {
    return NextResponse.json({ error: originCheck.error }, { status: originCheck.status });
  }
  const ip = clientIp(req);
  if (
    !rateLimit(`verify-resend:${ip}`, 5, 60 * 60_000) ||
    !emailDeliveryConfigured()
  ) {
    return NextResponse.json(
      { error: "暂时无法发送验证邮件" },
      { status: emailDeliveryConfigured() ? 429 : 503 }
    );
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "请输入有效邮箱" }, { status: 400 });
  }
  const email = normalizeEmail(parsed.data.email);
  if (!rateLimit(`verify-resend-email:${hashVerificationToken(email)}`, 3, 60 * 60_000)) {
    return NextResponse.json(
      { error: "请求过于频繁，请稍后再试" },
      { status: 429 }
    );
  }
  const user = await db.user.findUnique({ where: { email } });
  let devVerificationUrl: string | undefined;
  if (user && !user.emailVerifiedAt && !user.disabledAt) {
    try {
      const result = await sendVerificationEmail({
        userId: user.id,
        email,
        username: user.username,
      });
      devVerificationUrl = result.devVerificationUrl;
    } catch (error) {
      console.error("[email-verification] resend failed", error);
      return NextResponse.json({ error: "验证邮件发送失败，请稍后重试" }, { status: 502 });
    }
  }
  return NextResponse.json({
    ok: true,
    message: "如果该邮箱存在待验证账户，验证邮件已发送",
    ...(devVerificationUrl ? { dev_verification_url: devVerificationUrl } : {}),
  });
}
