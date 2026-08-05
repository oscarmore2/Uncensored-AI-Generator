import { PrismaClient } from "@prisma/client";

/**
 * 多渠道改造（WaveSpeed + Atlas Cloud）的结构迁移。
 *
 *   node scripts/migrate-provider-dimension.mjs
 *
 * 为什么不直接 `prisma db push`：
 * 这次要把 modelId 的全局唯一换成 (provider, modelId) 复合唯一，
 * db push 认为「加唯一约束可能因重复值失败」，会要求 --accept-data-loss。
 * 那个标志是把所有破坏性操作一起放行的钝器，不该用在生产库上。
 * 这里改成逐条执行本次真正需要的 DDL —— 全部是 ADD COLUMN（带默认值）
 * 与索引增删，不含 DROP TABLE / DROP COLUMN，因此存量数据一行不动。
 *
 * 幂等：所有语句都带 IF NOT EXISTS / IF EXISTS，重复执行安全。
 * 执行完再跑一次 `prisma db push`，它应当直接报 "already in sync"。
 */

const db = new PrismaClient();

// 存量行没有 provider，默认落回 wavespeed —— 与改造前的行为完全一致
const STATEMENTS = [
  ['Generation 增加 provider', `ALTER TABLE "Generation" ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'wavespeed'`],
  ['WaveSpeedAccount 增加 provider', `ALTER TABLE "WaveSpeedAccount" ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'wavespeed'`],
  ['WaveSpeedCatalogModel 增加 provider', `ALTER TABLE "WaveSpeedCatalogModel" ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'wavespeed'`],
  ['WaveSpeedCatalogModel 增加 schemaUrl', `ALTER TABLE "WaveSpeedCatalogModel" ADD COLUMN IF NOT EXISTS "schemaUrl" TEXT`],
  ['WaveSpeedProduct 增加 provider', `ALTER TABLE "WaveSpeedProduct" ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'wavespeed'`],
  ['WaveSpeedGeneration 增加 provider', `ALTER TABLE "WaveSpeedGeneration" ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'wavespeed'`],

  ['建 (provider, modelId) 复合唯一 · Catalog', `CREATE UNIQUE INDEX IF NOT EXISTS "WaveSpeedCatalogModel_provider_modelId_key" ON "WaveSpeedCatalogModel"("provider", "modelId")`],
  ['建 (provider, modelId) 复合唯一 · Product', `CREATE UNIQUE INDEX IF NOT EXISTS "WaveSpeedProduct_provider_modelId_key" ON "WaveSpeedProduct"("provider", "modelId")`],

  // 复合唯一建成之后才能撤掉旧的全局唯一，中间不留无约束窗口
  ['撤销 modelId 全局唯一 · Catalog', `DROP INDEX IF EXISTS "WaveSpeedCatalogModel_modelId_key"`],
  ['撤销 modelId 全局唯一 · Product', `DROP INDEX IF EXISTS "WaveSpeedProduct_modelId_key"`],

  ['建索引 Account(provider,isActive)', `CREATE INDEX IF NOT EXISTS "WaveSpeedAccount_provider_isActive_idx" ON "WaveSpeedAccount"("provider", "isActive")`],
  ['建索引 Catalog(provider,type)', `CREATE INDEX IF NOT EXISTS "WaveSpeedCatalogModel_provider_type_idx" ON "WaveSpeedCatalogModel"("provider", "type")`],
  ['建索引 Product(provider,isActive,isRecommended,sortOrder)', `CREATE INDEX IF NOT EXISTS "WaveSpeedProduct_provider_isActive_isRecommended_sortOrder_idx" ON "WaveSpeedProduct"("provider", "isActive", "isRecommended", "sortOrder")`],
  ['撤销旧索引 Catalog(type)', `DROP INDEX IF EXISTS "WaveSpeedCatalogModel_type_idx"`],
  ['撤销旧索引 Product(isActive,isRecommended,sortOrder)', `DROP INDEX IF EXISTS "WaveSpeedProduct_isActive_isRecommended_sortOrder_idx"`],
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
 * 确认待建的复合唯一索引不会撞。
 *
 * 必须按索引真正的键 (provider, modelId) 查重，不能只看 modelId：
 * 迁移跑过一轮、Atlas 全库同步之后，两家共有的模型（nano-banana、
 * seedream、wan 这些）会让 modelId 大量重复——那是设计如此，
 * 只查 modelId 会把一个已经迁移完成的库判成脏库，卡死后续所有部署。
 * 首次迁移时 provider 列还不存在，那时全表隐含同一个渠道，退回查 modelId 等价。
 */
async function assertNoDuplicates(table) {
  const hasProvider = await columnExists(table, "provider");
  const key = hasProvider ? `"provider", "modelId"` : `"modelId"`;
  const r = await db.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM (
       SELECT ${key} FROM "${table}" GROUP BY ${key} HAVING COUNT(*) > 1
     ) d`
  );
  const n = Number(r[0]?.n ?? 0);
  if (n > 0) {
    throw new Error(
      `${table} 有 ${n} 组重复的 ${hasProvider ? "(provider, modelId)" : "modelId"}，` +
        `复合唯一索引建不起来。请先人工处理重复行再重跑。`
    );
  }
}

try {
  for (const t of ["WaveSpeedCatalogModel", "WaveSpeedProduct", "WaveSpeedAccount", "WaveSpeedGeneration", "Generation"]) {
    if (!(await tableExists(t))) {
      throw new Error(`表 ${t} 不存在 —— 这个库还没跑过基础结构迁移，先执行 npm run db:deploy`);
    }
  }

  // 建唯一索引前先确认不会撞：旧库上 modelId 本就是全局唯一，正常必然为 0
  await assertNoDuplicates("WaveSpeedCatalogModel");
  await assertNoDuplicates("WaveSpeedProduct");

  const before = await countAll();

  for (const [label, sql] of STATEMENTS) {
    await db.$executeRawUnsafe(sql);
    console.log(`  ✅ ${label}`);
  }

  const after = await countAll();
  console.log("\n=== 行数对照（应完全一致）===");
  let drift = 0;
  for (const [t, n] of Object.entries(before)) {
    const m = after[t];
    if (n !== m) drift += 1;
    console.log(`  ${t.padEnd(24)} ${n} → ${m}${n === m ? "" : "   ⛔ 变了"}`);
  }
  if (drift > 0) throw new Error(`有 ${drift} 张表行数发生变化，请立即检查`);

  console.log("\n[migration] 多渠道结构迁移完成，存量数据全部归属 provider='wavespeed'。");
  console.log("下一步：npx prisma db push 应直接报 already in sync。");
} catch (err) {
  console.error("迁移失败：", err);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}

async function countAll() {
  const out = {};
  for (const t of [
    "User",
    "Generation",
    "WaveSpeedGeneration",
    "WaveSpeedProduct",
    "WaveSpeedCatalogModel",
    "WaveSpeedAccount",
    "GenerationProduct",
    "MediaAsset",
    "Transaction",
  ]) {
    const r = await db.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "${t}"`);
    out[t] = Number(r[0]?.n ?? 0);
  }
  return out;
}
