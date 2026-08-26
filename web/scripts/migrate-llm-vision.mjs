import { PrismaClient } from "@prisma/client";

/**
 * 给出厂就能读图的那几个模型打开 supportsVision。
 *
 *   node scripts/migrate-llm-vision.mjs
 *
 * **必须跑在 prisma db push 之后**：这一列是这次新加的，push 之前根本不存在。
 * 其余前置脚本都在 push 之前，只有这个在后面，别顺手挪上去。
 *
 * 为什么需要它：`LlmModel` 的播种是「只补不改」（价格是运营数据，不能被一次
 * 部署重置）。于是已经存在的行拿不到新字段的正确值，会停在列默认值 false ——
 * 表现是「引用了参考图但模型好像没看见」，而且没有任何报错。
 *
 * 只认**还指着出厂模型 id** 的行：运营要是已经把某一档换成别的模型了，
 * 那一行的读图能力得他自己判断，我们不该替他打开。
 *
 * 幂等：跑第二遍命中 0 行。
 */

const db = new PrismaClient();

/** 出厂默认里能读图的（2026-08 在 OpenRouter 的 input_modalities 上核对过） */
const VISION_MODEL_IDS = ["openai/gpt-4o-mini", "openai/gpt-4o"];

async function columnExists(table, column) {
  const r = await db.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM information_schema.columns
     WHERE table_name = '${table}' AND column_name = '${column}'`
  );
  return Number(r[0]?.n ?? 0) > 0;
}

try {
  if (!(await columnExists("LlmModel", "supportsVision"))) {
    console.log("[migration] LlmModel.supportsVision 还不存在，跳过。");
    process.exit(0);
  }

  const affected = await db.llmModel.updateMany({
    where: { providerModelId: { in: VISION_MODEL_IDS }, supportsVision: false },
    data: { supportsVision: true },
  });

  console.log(`[migration] ${affected.count} 个模型标记为可读图。`);
} catch (err) {
  console.error("[migration] 失败：", err.message);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
