import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

try {
  // 删除 Cryptomus 凭证、订单和 Webhook 明细；已到账的通用财务流水保留，
  // 但去除旧服务商名称，避免破坏用户余额的审计链。
  await db.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF to_regclass('"WebhookEventLog"') IS NOT NULL THEN
        DELETE FROM "WebhookEventLog" WHERE "provider" = 'cryptomus';
      END IF;
      IF to_regclass('"Transaction"') IS NOT NULL THEN
        UPDATE "Transaction"
        SET "method" = 'legacy_crypto'
        WHERE "method" = 'cryptomus' OR "method" LIKE 'cryptomus:%';
      END IF;
      DROP TABLE IF EXISTS "CryptoPayment" CASCADE;
      DROP TABLE IF EXISTS "CryptomusMerchant" CASCADE;
    END
    $$;
  `);
  console.log("[migration] Cryptomus credentials, orders, and webhook data removed.");
} finally {
  await db.$disconnect();
}
