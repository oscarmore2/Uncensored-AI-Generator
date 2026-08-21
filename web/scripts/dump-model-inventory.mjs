import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * 导出「配置在用的模型」清单，供人工复核能力归一化结果。
 *
 *   node scripts/dump-model-inventory.mjs            # markdown 表格
 *   node scripts/dump-model-inventory.mjs --json     # 机器可读
 *
 * 只读，不写任何表。
 *
 * 为什么不用人工填 API 链接：两家上游的 schema 同步时已经落进
 * ProviderCatalogModel.apiSchema 了（Atlas 走 schemaUrl 抓取，WaveSpeed 内联在
 * /models 响应里）。这里直接读库，人要做的只是复核派生结果对不对。
 */

const here = dirname(fileURLToPath(import.meta.url));
const CATALOG = resolve(here, "../src/lib/generation-catalog.ts");

/** 从候选表里抠出 model id。宁可多抓再用库过滤，也不写一个易碎的解析器 */
function idsFromCatalog() {
  const src = readFileSync(CATALOG, "utf8");
  const out = new Set();
  for (const m of src.matchAll(/"([a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._/-]*)"/g)) {
    out.add(m[1]);
  }
  return [...out];
}

/** 极简 schema 解读，只为给出「能力摘要」，正式派生器另行实现 */
function summarize(apiSchema) {
  if (!apiSchema) return { ok: false, note: "未同步 schema" };
  let root;
  try {
    root = JSON.parse(apiSchema);
  } catch {
    return { ok: false, note: "schema 非法 JSON" };
  }
  const node =
    root.api_schemas?.[0]?.request_schema ??
    root.request_schema ??
    root.components?.schemas?.Input ??
    (root.properties ? root : null);
  if (!node?.properties) return { ok: false, note: "schema 里没有 properties" };

  const required = new Set(
    (Array.isArray(node.required) ? node.required : []).filter((r) => r !== "model")
  );
  const media = [];
  for (const [name, spec] of Object.entries(node.properties)) {
    if (name === "model" || !spec || typeof spec !== "object") continue;
    const n = name.toLowerCase();
    let kind = null;
    if (/(audios?|voices?|speech|music|sound)s?$|^(audio|voice)_/.test(n)) kind = "audio";
    else if (/(videos?|footage|clips?)s?$|^video_/.test(n)) kind = "video";
    else if (/image|photo|picture|frame|face|mask|reference/.test(n)) kind = "image";
    if (!kind) continue;
    if (/^(num|n|count|batch|enable|output)_|_(count|size|num|format|quality|strength|scale|mode|type|weight|ratio|id|ids|index|name|names|prompt)$/.test(n)) continue;
    const isArray = spec.type === "array";
    if (!isArray && spec.type && spec.type !== "string") continue;
    media.push({
      field: name,
      kind,
      required: required.has(name),
      max: typeof spec.maxItems === "number" ? spec.maxItems : isArray ? null : 1,
      declaredMin: typeof spec.minItems === "number" ? spec.minItems : null,
    });
  }
  return { ok: true, media, requiredList: [...required] };
}

const db = new PrismaClient();
const asJson = process.argv.includes("--json");

try {
  const wanted = idsFromCatalog();
  const rows = await db.providerCatalogModel.findMany({
    where: { modelId: { in: wanted } },
    select: { provider: true, modelId: true, name: true, type: true, basePriceUsd: true, apiSchema: true },
    orderBy: [{ modelId: "asc" }, { provider: "asc" }],
  });
  const bound = await db.generationProduct.findMany({
    select: { provider: true, providerModelId: true },
  });
  const boundSet = new Set(bound.filter((b) => b.providerModelId).map((b) => `${b.provider}|${b.providerModelId}`));

  const found = new Set(rows.map((r) => r.modelId));
  const missing = wanted.filter((id) => !found.has(id));

  const items = rows.map((r) => {
    const s = summarize(r.apiSchema);
    return {
      provider: r.provider,
      model_id: r.modelId,
      name: r.name,
      type: r.type,
      base_price_usd: r.basePriceUsd,
      bound_to_product: boundSet.has(`${r.provider}|${r.modelId}`),
      schema_ok: s.ok,
      note: s.note ?? null,
      media_inputs: s.media ?? [],
      // 这一列最值得盯：声明了 minItems>0 却不在 required 里的字段，
      // 正是旧代码会误判成「必填」的那一类
      minItems_without_required: (s.media ?? []).filter((m) => (m.declaredMin ?? 0) > 0 && !m.required).map((m) => m.field),
    };
  });

  if (asJson) {
    console.log(JSON.stringify({ items, missing_from_catalog_db: missing }, null, 2));
  } else {
    console.log(`# 在用模型清单（配置引用 ${wanted.length} 个，库中命中 ${rows.length} 条）\n`);
    console.log("| provider | model_id | 已绑产品 | 媒体输入位（必填加*） | minItems 与 required 不一致 |");
    console.log("|---|---|---|---|---|");
    for (const it of items) {
      const inputs = it.schema_ok
        ? it.media_inputs.map((m) => `${m.field}:${m.kind}${m.required ? "*" : ""}${m.max ? `≤${m.max}` : ""}`).join("<br>") || "（无）"
        : `⚠ ${it.note}`;
      const bad = it.minItems_without_required.join(", ") || "—";
      console.log(`| ${it.provider} | \`${it.model_id}\` | ${it.bound_to_product ? "✅" : ""} | ${inputs} | ${bad} |`);
    }
    if (missing.length) {
      console.log(`\n## 配置引用了、但库里没有的 id（${missing.length} 个）\n`);
      console.log("这些要么是上游已下架，要么是 id 写错了——播种时会静默落到正则兜底。\n");
      for (const id of missing) console.log(`- \`${id}\``);
    }
  }
} catch (err) {
  console.error("导出失败：", err.message);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
