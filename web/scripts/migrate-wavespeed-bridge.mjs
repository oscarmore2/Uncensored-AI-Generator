import { PrismaClient } from "@prisma/client";

/**
 * Zen Creator → WaveSpeed 迁移前置脚本。
 *
 * `prisma db push` 会拒绝执行删表 / 删列，直接跑会让 Railway 的 release 失败。
 * 这里先用原生 SQL 把破坏性变更做掉，push 之后就只剩纯增量改动，
 * 无需在启动命令里全局打开 --accept-data-loss。
 *
 * 全部语句都带 IF EXISTS，可重复执行。
 */

const db = new PrismaClient();

/** 点数细分倍数：与 src/lib/generation-catalog.ts 的 CREDIT_GRANULARITY 保持一致 */
const CREDIT_GRANULARITY = 10;
const REDENOM_KEY = "credit_redenomination_v1";

/**
 * 点数细分改制：站内点数由「1 点 = ZC 1 点」改为「10 点 = ZC 1 点」，
 * 单点美元价随之降为 1/10，因此存量余额与赠点必须同步 ×10 才能保持购买力不变。
 * 用 AppSetting 打标，确保只执行一次（release 与每次启动都会跑本脚本）。
 */
async function redenominateCredits() {
  if (!(await tableExists("AppSetting"))) return;
  const done = await db.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS "n" FROM "AppSetting" WHERE "key" = '${REDENOM_KEY}'`
  );
  if (Number(done[0]?.n ?? 0) > 0) return;

  await db.$executeRawUnsafe(
    `UPDATE "User" SET "balance" = "balance" * ${CREDIT_GRANULARITY} WHERE "balance" > 0`
  );
  if (await tableExists("VipPlan")) {
    await db.$executeRawUnsafe(
      `UPDATE "VipPlan" SET "bonusCredits" = "bonusCredits" * ${CREDIT_GRANULARITY} WHERE "bonusCredits" > 0`
    );
  }
  await db.$executeRawUnsafe(
    `UPDATE "AppSetting"
        SET "value" = (("value")::int * ${CREDIT_GRANULARITY})::text, "updatedAt" = now()
      WHERE "key" = 'signup_initial_credits' AND "value" ~ '^[0-9]+$'`
  );
  await db.$executeRawUnsafe(
    `INSERT INTO "AppSetting" ("key", "value", "updatedAt")
     VALUES ('${REDENOM_KEY}', '${CREDIT_GRANULARITY}', now())`
  );
  console.log(`[migration] 存量点数已 ×${CREDIT_GRANULARITY}（购买力不变）`);
}

async function tableExists(name) {
  const rows = await db.$queryRawUnsafe(
    `SELECT to_regclass('"${name}"') IS NOT NULL AS "exists"`
  );
  return Boolean(rows[0]?.exists);
}

async function hasLegacyMediaChannels() {
  const rows = await db.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS "n" FROM "MediaCleanupPolicy" WHERE "channel" IN ('zen', 'wavespeed')`
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

async function columnExists(table, column) {
  const rows = await db.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS "n"
       FROM information_schema.columns
      WHERE table_name = '${table}' AND column_name = '${column}'`
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

try {
  if (!(await tableExists("Generation"))) {
    console.log("[migration] 全新数据库，交给 prisma db push 建表。");
  } else {
    // 是否为 Zen 时代的旧库：只有旧库才需要点数改制，新库与已迁移库都不该再 ×10
    const isLegacyDb =
      (await tableExists("ZenAccount")) ||
      (await columnExists("GenerationProduct", "zenModel")) ||
      (await columnExists("Generation", "zenAccountId"));

    // 1) 生成任务表：解绑 ZenAccount，丢弃只是 cost 副本的 Zen 点数估算列
    if (await columnExists("Generation", "zenAccountId")) {
      await db.$executeRawUnsafe(`ALTER TABLE "Generation" DROP COLUMN IF EXISTS "zenAccountId"`);
      console.log("[migration] 已移除 Generation.zenAccountId");
    }
    if (await columnExists("Generation", "zenCreditsCost")) {
      await db.$executeRawUnsafe(`ALTER TABLE "Generation" DROP COLUMN IF EXISTS "zenCreditsCost"`);
      console.log("[migration] 已移除 Generation.zenCreditsCost");
    }
    // zenJobId / zenError 通过 @map 保留，历史任务记录不受影响

    // 2) Zen 账户表整体下线
    if (await tableExists("ZenAccount")) {
      await db.$executeRawUnsafe(`DROP TABLE IF EXISTS "ZenAccount" CASCADE`);
      console.log("[migration] 已删除 ZenAccount 表");
    }

    // 3) 旧版产品表结构与新档位体系不兼容（zenTool/zenModel/variantKey → mode+tier+spicy），
    //    整表重建；档位与价格会在应用启动时按蓝图重新播种。
    if (await tableExists("GenerationProduct") && (await columnExists("GenerationProduct", "zenModel"))) {
      await db.$executeRawUnsafe(`DROP TABLE IF EXISTS "GenerationProduct" CASCADE`);
      console.log("[migration] 已重建 GenerationProduct（旧 zenModel 结构）");
    }

    // 播种已改为「表空才建、只补不改」，不再需要版本号闸门；
    // 清掉遗留键，避免以后有人误以为它还在控制播种。
    if (await tableExists("AppSetting")) {
      await db.$executeRawUnsafe(
        `DELETE FROM "AppSetting" WHERE "key" = 'generation_catalog_seed_version'`
      );
    }

    // 4) 媒体清理策略里的渠道标识与生成端保持一致。
    //    只在确实还有旧渠道行时才动手，否则每次部署都白跑一遍并打出误导性日志。
    if ((await tableExists("MediaCleanupPolicy")) && (await hasLegacyMediaChannels())) {
      await db.$executeRawUnsafe(
        `DELETE FROM "MediaCleanupPolicy"
          WHERE "channel" = 'main'
            AND EXISTS (
              SELECT 1 FROM "MediaCleanupPolicy" p2
               WHERE p2."channel" = 'zen'
                 AND p2."mediaType" = "MediaCleanupPolicy"."mediaType"
                 AND p2."audience" = "MediaCleanupPolicy"."audience"
            )`
      );
      await db.$executeRawUnsafe(
        `UPDATE "MediaCleanupPolicy" SET "channel" = 'main' WHERE "channel" = 'zen'`
      );
      await db.$executeRawUnsafe(
        `DELETE FROM "MediaCleanupPolicy"
          WHERE "channel" = 'plaything'
            AND EXISTS (
              SELECT 1 FROM "MediaCleanupPolicy" p2
               WHERE p2."channel" = 'wavespeed'
                 AND p2."mediaType" = "MediaCleanupPolicy"."mediaType"
                 AND p2."audience" = "MediaCleanupPolicy"."audience"
            )`
      );
      await db.$executeRawUnsafe(
        `UPDATE "MediaCleanupPolicy" SET "channel" = 'plaything' WHERE "channel" = 'wavespeed'`
      );
      console.log("[migration] 媒体清理渠道标识已更新为 main / plaything");
    }

    if (isLegacyDb) await redenominateCredits();
    console.log("[migration] Zen → WaveSpeed 结构迁移完成。");
  }
} catch (err) {
  console.error("[migration] 迁移失败：", err);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
