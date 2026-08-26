import { PrismaClient } from "@prisma/client";

/**
 * 已存在的用户技能一律标记为「独立」。
 *
 *   node scripts/migrate-skill-fork-link.mjs
 *
 * 背景：S3 刚上线时，「复制官方技能」是当场拷一份快照，此后各走各的，
 * 那一版把新行写成 `isOverridden = false`（当时这个字段对用户技能没有含义）。
 *
 * 现在改成了「复制先只是一个引用」：`isOverridden = false` 的用户副本会**跟着
 * 官方技能一起变**。于是那批老行的语义整个反过来了——如果用户已经改过其中一条，
 * 下一次管理端编辑官方技能，就会把他的改动**静默冲掉**。
 *
 * 所以这里一刀切：存量用户技能全部当作「已独立」。代价是「复制了但还没改」的
 * 那几条不会自动跟随，用户删掉重新复制一次即可；换来的是**没有任何人的改动
 * 会被悄悄覆盖**。这个方向的取舍不需要犹豫。
 *
 * 只 UPDATE 一列，不动表结构，不删任何行。幂等：跑第二遍命中 0 行。
 */

const db = new PrismaClient();

async function tableExists(name) {
  const r = await db.$queryRawUnsafe(`SELECT to_regclass('"${name}"') IS NOT NULL AS "e"`);
  return Boolean(r[0]?.e);
}

async function columnExists(table, column) {
  const r = await db.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM information_schema.columns
     WHERE table_name = '${table}' AND column_name = '${column}'`
  );
  return Number(r[0]?.n ?? 0) > 0;
}

try {
  // 全新库还没有 Skill 表，交给 prisma db push 建，不要卡住链条
  if (!(await tableExists("Skill"))) {
    console.log("[migration] 还没有 Skill 表，跳过。");
    process.exit(0);
  }
  if (!(await columnExists("Skill", "isOverridden"))) {
    console.log("[migration] Skill.isOverridden 还不存在，跳过。");
    process.exit(0);
  }

  const before = await db.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "Skill" WHERE "scope" = 'user'`
  );
  const total = Number(before[0]?.n ?? 0);

  const affected = await db.$executeRawUnsafe(
    `UPDATE "Skill" SET "isOverridden" = true WHERE "scope" = 'user' AND "isOverridden" = false`
  );

  const after = await db.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "Skill" WHERE "scope" = 'user'`
  );
  if (Number(after[0]?.n ?? 0) !== total) {
    throw new Error("用户技能行数发生变化，迁移已中止，请人工核查");
  }

  console.log(
    `[migration] 存量用户技能 ${total} 条，其中 ${affected} 条标记为已独立（不再跟随官方）。`
  );
} catch (err) {
  console.error("[migration] 失败：", err.message);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
