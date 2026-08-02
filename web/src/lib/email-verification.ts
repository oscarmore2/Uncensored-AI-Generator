import "server-only";
import crypto from "crypto";
import { db } from "./db";
import { env } from "./env";
import { absoluteUrl, SITE_NAME } from "./site";

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashVerificationToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function emailDeliveryConfigured(): boolean {
  return env.DEMO_MODE || Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character] ?? character
  );
}

export async function issueEmailVerification(userId: number): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashVerificationToken(token);
  await db.$transaction([
    db.emailVerificationToken.deleteMany({
      where: { userId, consumedAt: null },
    }),
    db.emailVerificationToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      },
    }),
  ]);
  return token;
}

export async function sendVerificationEmail(params: {
  userId: number;
  email: string;
  username: string;
}): Promise<{ devVerificationUrl?: string }> {
  const token = await issueEmailVerification(params.userId);
  const verificationUrl = absoluteUrl(
    `/api/auth/verify-email?token=${encodeURIComponent(token)}`
  );

  if (env.DEMO_MODE) {
    console.info(`[email-verification] Demo link for ${params.email}: ${verificationUrl}`);
    return { devVerificationUrl: verificationUrl };
  }
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    throw new Error("Email delivery is not configured");
  }

  const safeName = escapeHtml(params.username);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `verify-${params.userId}-${hashVerificationToken(token).slice(0, 24)}`,
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [params.email],
      subject: `验证你的 ${SITE_NAME} 邮箱 / Verify your email`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#18181b">
          <h1 style="font-size:24px">${SITE_NAME}</h1>
          <p>你好 ${safeName}，请点击下方按钮验证邮箱。链接将在 24 小时后失效。</p>
          <p>Hello ${safeName}, verify your email using the button below. This link expires in 24 hours.</p>
          <p style="margin:28px 0">
            <a href="${verificationUrl}" style="display:inline-block;background:#f97316;color:white;text-decoration:none;padding:12px 20px;border-radius:12px">验证邮箱 / Verify email</a>
          </p>
          <p style="font-size:12px;color:#71717a;word-break:break-all">${verificationUrl}</p>
          <p style="font-size:12px;color:#71717a">如果你没有创建账户，可以忽略本邮件。</p>
        </div>
      `,
      text: `Verify your ${SITE_NAME} email within 24 hours: ${verificationUrl}`,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Resend email failed (${response.status}): ${detail.slice(0, 300)}`);
  }
  return {};
}
