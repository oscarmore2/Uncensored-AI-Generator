import { PrismaClient } from "@prisma/client";

/**
 * 作品分享链接：Generation 增加 shareToken（可空 + 唯一）。
 *
 *   node scripts/migrate-share-token.mjs
 *
 * 为什么不直接 `prisma db push`：
 * db push 看到「新增唯一约束」就一律警告可能因重复值失败，要求 --accept-data-loss。
 * 这里的判断是错的——新列全是 NULL，而 Postgres 的唯一索引不约束 NULL，
 * 一亿行 NULL 也不算重复。但 --accept-data-loss 是把所有破坏性操作一起放行的钝器，
 * 加在 db:deploy 上等于以后每次部署都对 DROP COLUMN 之类闭着眼放行。
 * 所以照 migrate-provider-dimension 的老办法：这里先把 DDL 做掉，
 * db push 随后看到的就是 already in sync。
 *
 * 本次全部是 ADD COLUMN（可空、无默认值，不重写表）与建索引，存量数据一行不动。
 * 幂等：带 IF NOT EXISTS，重复执行安全。
 */

const db = new PrismaClient();

const STATEMENTS = [
  [
    "Generation 增加 shareToken",
    `ALTER TABLE "Generation" ADD COLUMN IF NOT EXISTS "shareToken" TEXT`,
  ],
  [
    "建 shareToken 唯一索引",
    `CREATE UNIQUE INDEX IF NOT EXISTS "Generation_shareToken_key" ON "Generation"("shareToken")`,
  ],
];

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

/**
 * 建唯一索引前确认非空值里没有重复。
 * 正常情况必然是 0（令牌是随机生成的），但重跑一个手工改过的库时值得先看一眼——
 * 索引建不起来的话报错在这里，比让 db push 在半路失败清楚得多。
 */
async function assertNoDuplicateTokens() {
  if (!(await columnExists("Generation", "shareToken"))) return;
  const r = await db.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM (
       SELECT "shareToken" FROM "Generation"
       WHERE "shareToken" IS NOT NULL
       GROUP BY "shareToken" HAVING COUNT(*) > 1
     ) d`
  );
  const n = Number(r[0]?.n ?? 0);
  if (n > 0) {
    throw new Error(`Generation 有 ${n} 组重复的 shareToken，唯一索引建不起来。请先人工处理再重跑。`);
  }
}

try {
  if (!(await tableExists("Generation"))) {
    throw new Error("表 Generation 不存在 —— 这个库还没跑过基础结构迁移");
  }

  const before = await db.generation.count();
  await assertNoDuplicateTokens();

  for (const [label, sql] of STATEMENTS) {
    await db.$executeRawUnsafe(sql);
    console.log(`  ✅ ${label}`);
  }

  const after = await db.generation.count();
  console.log(`\n=== 行数对照（应完全一致）===\n  Generation  ${before} → ${after}`);
  if (before !== after) throw new Error("行数发生变化，迁移已中止，请人工核查");

  console.log("\n[migration] 分享令牌字段就绪。下一步：prisma db push 应直接报 already in sync。");
} catch (err) {
  console.error("[migration] 失败：", err.message);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
