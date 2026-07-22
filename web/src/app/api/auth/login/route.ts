import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";
import { createSessionCookie } from "@/lib/session";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { userOut } from "@/lib/serialize";
import { ensureSeedUsers } from "@/lib/demo";
import { z } from "zod";

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
});

export async function POST(req: Request) {
  if (!rateLimit(`login:${clientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: "请求过于频繁，请稍后再试" }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "请输入用户名和密码" }, { status: 400 });
  }

  const { username, password } = parsed.data;
  if (["demo_user", "mod_user", "admin_user", process.env.SEED_ADMIN_USERNAME].includes(username)) {
    await ensureSeedUsers();
  }
  const user = await db.user.findUnique({ where: { username } });
  if (!user || !(await verifyPassword(password, user.hashedPassword))) {
    return NextResponse.json({ error: "用户名或密码错误" }, { status: 401 });
  }
  if (user.disabledAt) {
    return NextResponse.json({ error: "账号已被封禁，如有疑问请联系客服" }, { status: 403 });
  }

  await createSessionCookie(user.id, user.username, user.role);
  return NextResponse.json(userOut(user));
}
