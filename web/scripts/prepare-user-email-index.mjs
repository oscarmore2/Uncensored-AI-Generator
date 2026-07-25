import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

try {
  const userTable = await db.$queryRawUnsafe(`
    SELECT to_regclass('"User"') IS NOT NULL AS "exists"
  `);

  if (!userTable[0]?.exists) {
    console.log("[migration] User table does not exist yet; Prisma will create it.");
  } else {
    // Adding a nullable column is non-destructive. Creating the expected index here avoids
    // globally accepting every future Prisma data-loss warning during application startup.
    await db.$executeRawUnsafe(`
      ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "email" TEXT
    `);

    const duplicateGroups = await db.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS "groups"
      FROM (
        SELECT lower(btrim("email"))
        FROM "User"
        WHERE "email" IS NOT NULL
        GROUP BY lower(btrim("email"))
        HAVING COUNT(*) > 1
      ) duplicates
    `);
    const groups = Number(duplicateGroups[0]?.groups ?? 0);
    if (groups > 0) {
      throw new Error(
        `[migration] Cannot add User.email uniqueness: found ${groups} duplicate normalized email group(s). Resolve them before redeploying.`
      );
    }

    await db.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email")
    `);
    console.log("[migration] User.email column and unique index are ready.");
  }
} finally {
  await db.$disconnect();
}
