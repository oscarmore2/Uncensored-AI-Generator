import "server-only";
import { db } from "./db";
import { env } from "./env";
import { hashPassword } from "./auth";

/** Demo 模式下自动创建演示账号（demo_user / demo123），生产模式不生效 */
export async function ensureDemoUser(): Promise<void> {
  if (!env.DEMO_MODE) return;
  const existing = await db.user.findUnique({ where: { username: "demo_user" } });
  if (!existing) {
    await db.user.create({
      data: {
        username: "demo_user",
        hashedPassword: await hashPassword("demo123"),
        balance: 128,
      },
    });
  }
}

/** Demo 模式下创建审核员账号（mod_user / mod123） */
export async function ensureModUser(): Promise<void> {
  if (!env.DEMO_MODE) return;
  const existing = await db.user.findUnique({ where: { username: "mod_user" } });
  if (!existing) {
    await db.user.create({
      data: {
        username: "mod_user",
        hashedPassword: await hashPassword("mod123"),
        role: "moderator",
        balance: 0,
      },
    });
  }
}

/** Demo 模式下创建管理员账号（admin_user / admin123） */
export async function ensureAdminUser(): Promise<void> {
  if (!env.DEMO_MODE) return;
  const existing = await db.user.findUnique({ where: { username: "admin_user" } });
  if (!existing) {
    await db.user.create({
      data: {
        username: "admin_user",
        hashedPassword: await hashPassword("admin123"),
        role: "admin",
        balance: 0,
      },
    });
  }
}

/** 通过环境变量创建/提升 admin 账号（生产可用） */
export async function ensureSeedAdmin(): Promise<void> {
  const username = process.env.SEED_ADMIN_USERNAME;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!username || !password || password.length < 8) return;

  const existing = await db.user.findUnique({ where: { username } });
  if (existing) {
    if (existing.role !== "admin") {
      await db.user.update({ where: { id: existing.id }, data: { role: "admin" } });
    }
    return;
  }
  await db.user.create({
    data: { username, hashedPassword: await hashPassword(password), role: "admin", balance: 0 },
  });
}

export async function ensureSeedUsers(): Promise<void> {
  await ensureDemoUser();
  await ensureModUser();
  await ensureAdminUser();
  await ensureSeedAdmin();
}
