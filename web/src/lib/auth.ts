import "server-only";
import bcrypt from "bcryptjs";
import type { User } from "@prisma/client";
import { db } from "./db";
import { getSession } from "./session";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hashed: string): Promise<boolean> {
  return bcrypt.compare(password, hashed);
}

/** 从会话 Cookie 解析当前用户；无效或已封禁则返回 null */
export async function getCurrentUser(): Promise<User | null> {
  const session = await getSession();
  if (!session) return null;
  const id = Number(session.sub);
  if (!Number.isInteger(id)) return null;
  const user = await db.user.findUnique({ where: { id } });
  if (user?.disabledAt) return null;
  return user;
}

/**
 * 要求当前用户具备指定角色之一（以数据库中的 role 为准，防止 JWT 与库不同步）。
 * 未登录或角色不符时返回 null。
 */
export async function requireRole(...roles: string[]): Promise<User | null> {
  const user = await getCurrentUser();
  if (!user || !roles.includes(user.role)) return null;
  return user;
}
