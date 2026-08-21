import "server-only";
import { db } from "./db";
import { deriveCapability, schemaFingerprint } from "./model-capability";

/**
 * 能力档案的落库侧。派生逻辑在 model-capability.ts（纯函数，可单测）。
 *
 * 两条铁律：
 * 1. **人工覆盖不被自动派生冲掉**。source=manual 的记录，schema 变了只打
 *    staleSince 标记进待复核队列，内容一个字不动——不然管理端改一次、
 *    下一轮同步就白改了，没人会再去改第二次。
 * 2. schema 没变就不重算。指纹一致直接跳过，1278 个模型每次同步全量重算
 *    是纯浪费。
 */

export type UpsertResult = { derived: number; skipped: number; markedStale: number };

export async function refreshCapabilities(provider: string): Promise<UpsertResult> {
  const models = await db.providerCatalogModel.findMany({
    where: { provider },
    select: { modelId: true, type: true, apiSchema: true },
  });
  const existing = await db.modelCapability.findMany({
    where: { provider },
    select: { modelId: true, source: true, schemaHash: true, staleSince: true },
  });
  const byId = new Map(existing.map((e) => [e.modelId, e]));

  const out: UpsertResult = { derived: 0, skipped: 0, markedStale: 0 };
  const now = new Date();

  for (const m of models) {
    const hash = schemaFingerprint(m.apiSchema);
    const prev = byId.get(m.modelId);

    if (prev && prev.schemaHash === hash) {
      out.skipped += 1;
      continue;
    }

    if (prev && prev.source === "manual") {
      // 人工改过：只标记待复核，内容不动
      if (!prev.staleSince) {
        await db.modelCapability.update({
          where: { provider_modelId: { provider, modelId: m.modelId } },
          data: { staleSince: now },
        });
        out.markedStale += 1;
      } else {
        out.skipped += 1;
      }
      continue;
    }

    const cap = deriveCapability({ modelId: m.modelId, type: m.type, apiSchema: m.apiSchema });
    const data = {
      inputs: JSON.stringify(cap.inputs),
      outputs: JSON.stringify(cap.outputs),
      notes: JSON.stringify(cap.notes),
      source: "derived",
      schemaHash: hash,
      staleSince: null,
    };
    await db.modelCapability.upsert({
      where: { provider_modelId: { provider, modelId: m.modelId } },
      create: { provider, modelId: m.modelId, ...data },
      update: data,
    });
    out.derived += 1;
  }

  return out;
}
