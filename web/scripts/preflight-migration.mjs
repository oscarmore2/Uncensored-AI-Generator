import { PrismaClient } from "@prisma/client";

/**
 * 迁移前的只读体检。
 *
 * 不写任何数据，只回答一个问题：在这个库上执行 `npm run db:deploy`，
 * 会不会碰到破坏性操作？
 *
 * db:deploy = migrate-wavespeed-bridge.mjs && prisma db push
 * 前者带了几条 DROP，都有前置判断；后者不带 --accept-data-loss，
 * 遇到会丢数据的变更会直接报错退出。这里逐条把前置判断实际跑一遍。
 *
 *   node scripts/preflight-migration.mjs
 */

const db = new PrismaClient();

let danger = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => {
  danger += 1;
  console.log(`  ⛔ ${m}`);
};

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
async function count(table) {
  if (!(await tableExists(table))) return null;
  const r = await db.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "${table}"`);
  return Number(r[0]?.n ?? 0);
}

try {
  console.log("=== 迁移脚本里的破坏性操作，逐条检查前置条件 ===\n");

  if (await tableExists("ZenAccount")) {
    bad("ZenAccount 表还在 —— 迁移会 DROP TABLE 把它删掉");
  } else {
    ok("ZenAccount 表已不存在，删表语句不会触发");
  }

  if ((await tableExists("GenerationProduct")) && (await columnExists("GenerationProduct", "zenModel"))) {
    const n = await count("GenerationProduct");
    bad(`GenerationProduct 仍是旧结构（有 zenModel 列）—— 迁移会整表重建，现有 ${n} 行档位配置会丢`);
  } else {
    ok("GenerationProduct 已是新结构，整表重建不会触发（档位与价格配置安全）");
  }

  for (const col of ["zenAccountId", "zenCreditsCost"]) {
    if (await columnExists("Generation", col)) {
      bad(`Generation.${col} 还在 —— 迁移会删掉这一列`);
    } else {
      ok(`Generation.${col} 已不存在，删列不会触发`);
    }
  }

  const legacyDb =
    (await tableExists("ZenAccount")) ||
    (await columnExists("GenerationProduct", "zenModel")) ||
    (await columnExists("Generation", "zenAccountId"));
  const doneRows = (await tableExists("AppSetting"))
    ? await db.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS n FROM "AppSetting" WHERE "key" = 'credit_redenomination_v1'`
      )
    : [{ n: 1 }];
  const redenomDone = Number(doneRows[0]?.n ?? 0) > 0;
  if (legacyDb && !redenomDone) {
    bad("会触发点数 ×10 改制 —— 所有用户余额、VIP 赠点、注册赠点都会乘以 10");
  } else {
    ok(`点数 ×10 改制不会触发（${redenomDone ? "已执行过" : "非旧库"}）`);
  }

  // 多渠道改造：把 modelId 的全局唯一换成 (provider, modelId) 复合唯一。
  // 旧库上 modelId 本来就是全局唯一，所以复合唯一必然建得起来；
  // 这里仍然实测一遍，因为一旦有重复，迁移会在建索引时中断。
  for (const t of ["WaveSpeedCatalogModel", "WaveSpeedProduct"]) {
    if (!(await tableExists(t))) continue;
    if (await columnExists(t, "provider")) {
      ok(`${t} 已有 provider 列（多渠道改造已迁移过）`);
      continue;
    }
    const dup = await db.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM (SELECT "modelId" FROM "${t}" GROUP BY 1 HAVING COUNT(*) > 1) d`
    );
    const n = Number(dup[0]?.n ?? 0);
    if (n > 0) {
      bad(`${t} 有 ${n} 个重复 modelId —— (provider, modelId) 复合唯一索引会建不起来`);
    } else {
      ok(`${t} 无重复 modelId，复合唯一索引可安全建立`);
    }
  }

  const legacyChan = (await tableExists("MediaCleanupPolicy"))
    ? await db.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS n FROM "MediaCleanupPolicy" WHERE "channel" IN ('zen','wavespeed')`
      )
    : [{ n: 0 }];
  if (Number(legacyChan[0]?.n ?? 0) > 0) {
    console.log("  ⚠️  存在旧渠道标识，会被改名为 main / plaything（只改标识，不删策略）");
  } else {
    ok("媒体清理渠道标识已是新值，改名不会触发");
  }

  console.log("\n=== 当前数据量（迁移后可对照，数字应当不变）===");
  for (const t of ["User", "Generation", "WaveSpeedGeneration", "MediaAsset",
                   "GenerationProduct", "CreditPackage", "VipPlan", "PublicWork", "Transaction"]) {
    const n = await count(t);
    console.log(`  ${t.padEnd(22)} ${n === null ? "（表不存在）" : n}`);
  }

  console.log("\n=== 结论 ===");
  if (danger === 0) {
    console.log("  本库上没有任何破坏性操作会被触发。");
    console.log("  prisma db push 若还想删列，会因为缺少 --accept-data-loss 直接报错退出，不会执行。");
    console.log("  建议仍先在 Railway 做一次数据库备份再跑。");
  } else {
    console.log(`  发现 ${danger} 项破坏性操作会被触发 —— 先备份，并逐条确认后再决定。`);
  }
  process.exitCode = danger === 0 ? 0 : 1;
} catch (err) {
  console.error("预检失败：", err);
  process.exitCode = 2;
} finally {
  await db.$disconnect();
}
