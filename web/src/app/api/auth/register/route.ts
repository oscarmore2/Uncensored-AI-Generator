import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { createSessionCookie } from "@/lib/session";
import { credentialsSchema } from "@/lib/validators";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { userOut } from "@/lib/serialize";
import { sendTelegram } from "@/lib/telegram";

export async function POST(req: Request) {
  if (!rateLimit(`register:${clientIp(req)}`, 5, 60_000)) {
    return NextResponse.json({ error: "请求过于频繁，请稍后再试" }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = credentialsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { username, password } = parsed.data;
  const existing = await db.user.findUnique({ where: { username } });
  if (existing) {
    return NextResponse.json({ error: "用户名已被注册" }, { status: 400 });
  }

  const user = await db.user.create({
    data: { username, hashedPassword: await hashPassword(password) },
  });
  sendTelegram(`🆕 新用户注册: ${user.username} (ID ${user.id})`);

  await createSessionCookie(user.id, user.username, user.role);
  return NextResponse.json(userOut(user), { status: 201 });
}
