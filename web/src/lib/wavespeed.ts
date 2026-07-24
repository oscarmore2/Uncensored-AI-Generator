import "server-only";
import { db } from "./db";
import { env } from "./env";
import { decryptSecret } from "./secret-crypto";
import { mirrorRemoteUrls } from "./oss";
import { sendTelegram } from "./telegram";
import { ensureDefaultPlaythingProducts } from "./wavespeed-seed";

export type WaveSpeedCredentials = {
  apiKey: string;
  baseUrl: string;
  accountId: number | null;
  source: "db" | "env";
  label: string;
};

export type RemoteWaveSpeedModel = {
  model_id: string;
  name?: string;
  type?: string;
  description?: string;
  base_price?: number;
  cover_url?: string;
  thumbnail_url?: string;
  thumbnail?: string;
  api_schema?: unknown;
};

type WsEnvelope<T> = {
  code?: number;
  message?: string;
  data?: T;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 优先管理端激活账户；无激活时回退 .env WAVESPEED_API_KEY */
export async function getActiveWaveSpeedCredentials(): Promise<WaveSpeedCredentials | null> {
  const active = await db.waveSpeedAccount.findFirst({ where: { isActive: true } });
  if (active) {
    return {
      apiKey: decryptSecret(active.apiKeyEnc),
      baseUrl: env.WAVESPEED_BASE_URL,
      accountId: active.id,
      source: "db",
      label: active.label,
    };
  }
  if (env.WAVESPEED_API_KEY) {
    return {
      apiKey: env.WAVESPEED_API_KEY,
      baseUrl: env.WAVESPEED_BASE_URL,
      accountId: null,
      source: "env",
      label: "env",
    };
  }
  return null;
}

export async function wavespeedConfigured(): Promise<boolean> {
  return Boolean(await getActiveWaveSpeedCredentials());
}

export async function wavespeedFetch<T = unknown>(
  apiKey: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const base = env.WAVESPEED_BASE_URL.replace(/\/$/, "");
  const url = path.startsWith("http") ? path : `${base}${path.startsWith("/") ? "" : "/"}${path}`;
  const resp = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await resp.text().catch(() => "");
  let json: WsEnvelope<T> | null = null;
  try {
    json = text ? (JSON.parse(text) as WsEnvelope<T>) : null;
  } catch {
    json = null;
  }
  if (!resp.ok) {
    throw new Error(`WaveSpeed ${resp.status}: ${(json?.message || text || resp.statusText).slice(0, 300)}`);
  }
  if (json && typeof json.code === "number" && json.code !== 200) {
    throw new Error(`WaveSpeed API: ${(json.message || `code ${json.code}`).slice(0, 300)}`);
  }
  return (json?.data !== undefined ? json.data : (json as unknown as T)) as T;
}

/** 轻量校验：拉一次模型列表（取前几条即可） */
export async function testWaveSpeedKey(apiKey: string): Promise<void> {
  await wavespeedFetch(apiKey, "/models");
}

export async function listRemoteModels(apiKey?: string): Promise<RemoteWaveSpeedModel[]> {
  const key = apiKey ?? (await getActiveWaveSpeedCredentials())?.apiKey;
  if (!key) throw new Error("未配置 WaveSpeed API Key");
  const data = await wavespeedFetch<RemoteWaveSpeedModel[] | { items?: RemoteWaveSpeedModel[] }>(
    key,
    "/models"
  );
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

export function extractThumbnailUrl(m: RemoteWaveSpeedModel): string | null {
  const raw =
    m.cover_url ||
    m.thumbnail_url ||
    m.thumbnail ||
    (m as { cover?: string }).cover ||
    null;
  return typeof raw === "string" && raw.startsWith("http") ? raw : null;
}

/** 同步远端全库到 WaveSpeedCatalogModel，并尝试预上架推荐模型 */
export async function syncWaveSpeedCatalog(): Promise<{
  upserted: number;
  total: number;
  seeded: number;
}> {
  const creds = await getActiveWaveSpeedCredentials();
  if (!creds) throw new Error("未配置 WaveSpeed API Key，请先在管理端添加并激活，或配置 WAVESPEED_API_KEY");

  const remote = await listRemoteModels(creds.apiKey);
  const now = new Date();
  let upserted = 0;

  for (const m of remote) {
    const modelId = (m.model_id || m.name || "").trim();
    if (!modelId) continue;
    const name = (m.name || modelId).trim();
    const type = (m.type || "").trim();
    const description = (m.description || "").slice(0, 4000);
    const basePriceUsd = typeof m.base_price === "number" ? m.base_price : 0;
    const thumbnailUrl = extractThumbnailUrl(m);
    const apiSchema = m.api_schema != null ? JSON.stringify(m.api_schema) : null;

    await db.waveSpeedCatalogModel.upsert({
      where: { modelId },
      create: {
        modelId,
        name,
        type,
        description,
        basePriceUsd,
        thumbnailUrl,
        apiSchema,
        syncedAt: now,
      },
      update: {
        name,
        type,
        description,
        basePriceUsd,
        ...(thumbnailUrl ? { thumbnailUrl } : {}),
        apiSchema,
        syncedAt: now,
      },
    });
    upserted += 1;
  }

  const seeded = await ensureDefaultPlaythingProducts();
  return { upserted, total: remote.length, seeded };
}

export async function estimatePricing(
  modelId: string,
  inputs: Record<string, unknown>
): Promise<number | null> {
  const creds = await getActiveWaveSpeedCredentials();
  if (!creds) throw new Error("未配置 WaveSpeed API Key");
  try {
    const data = await wavespeedFetch<{ unit_price?: number; price?: number }>(
      creds.apiKey,
      "/model/pricing",
      { method: "POST", body: JSON.stringify({ model_id: modelId, inputs }) }
    );
    const price =
      typeof data?.unit_price === "number"
        ? data.unit_price
        : typeof data?.price === "number"
          ? data.price
          : null;
    if (price != null) {
      await db.waveSpeedCatalogModel.updateMany({
        where: { modelId },
        data: { lastUnitPriceUsd: price },
      });
    }
    return price;
  } catch {
    return null;
  }
}

export async function submitWaveSpeedTask(
  apiKey: string,
  modelId: string,
  inputs: Record<string, unknown>
): Promise<{ id: string; status: string }> {
  const data = await wavespeedFetch<{ id?: string; status?: string }>(
    apiKey,
    `/${modelId}`,
    { method: "POST", body: JSON.stringify(inputs) }
  );
  const id = data?.id;
  if (!id) throw new Error("WaveSpeed 未返回任务 ID");
  return { id, status: data.status || "created" };
}

export async function pollWaveSpeedResult(
  apiKey: string,
  taskId: string
): Promise<{
  status: string;
  outputs: string[];
  error?: string;
}> {
  const data = await wavespeedFetch<{
    status?: string;
    outputs?: unknown;
    output?: unknown;
    error?: string;
    data?: { outputs?: unknown; status?: string; error?: string };
  }>(apiKey, `/predictions/${encodeURIComponent(taskId)}/result`);

  const status = String(data?.status || data?.data?.status || "processing").toLowerCase();
  const err = data?.error || data?.data?.error;
  const rawOutputs = data?.outputs ?? data?.output ?? data?.data?.outputs ?? [];
  const outputs = normalizeOutputs(rawOutputs);
  return { status, outputs, error: err ? String(err) : undefined };
}

function normalizeOutputs(raw: unknown): string[] {
  if (!raw) return [];
  if (typeof raw === "string" && raw.startsWith("http")) return [raw];
  if (!Array.isArray(raw)) return [];
  const urls: string[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.startsWith("http")) urls.push(item);
    else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const u = o.url || o.download_url || o.image || o.video;
      if (typeof u === "string" && u.startsWith("http")) urls.push(u);
    }
  }
  return urls;
}

function mapWsStatus(status: string): "pending" | "processing" | "succeeded" | "failed" {
  const s = status.toLowerCase();
  if (["completed", "succeeded", "success", "done"].includes(s)) return "succeeded";
  if (["failed", "error", "cancelled", "canceled"].includes(s)) return "failed";
  if (["created", "queued", "pending"].includes(s)) return "pending";
  return "processing";
}

/** 从 apiSchema / override 解析可提交的默认 inputs，合并用户 params */
export function buildWaveSpeedInputs(
  product: { paramSchemaOverride: string | null; catalogModel?: { apiSchema: string | null } | null },
  prompt: string,
  params: Record<string, unknown>
): Record<string, unknown> {
  const schemaJson = product.paramSchemaOverride || product.catalogModel?.apiSchema;
  const defaults = extractSchemaDefaults(schemaJson);
  const inputs: Record<string, unknown> = { ...defaults, ...params };
  if (prompt.trim()) {
    inputs.prompt = prompt.trim();
  }
  // 去掉仅本地字段
  delete inputs._local;
  delete inputs.image_base64;
  return inputs;
}

function extractSchemaDefaults(schemaJson: string | null | undefined): Record<string, unknown> {
  if (!schemaJson) return {};
  try {
    const root = JSON.parse(schemaJson) as {
      api_schemas?: Array<{ request_schema?: { properties?: Record<string, { default?: unknown }> } }>;
      properties?: Record<string, { default?: unknown }>;
    };
    const props =
      root.api_schemas?.[0]?.request_schema?.properties ||
      root.properties ||
      {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props)) {
      if (v && typeof v === "object" && "default" in v && v.default !== undefined) {
        out[k] = v.default;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** 本站报价：仅用 creditCost，永不应用 VIP 折扣 */
export function resolvePlaythingQuote(creditCost: number): { cost: number; discountBps: 0 } {
  return { cost: Math.max(1, Math.floor(creditCost)), discountBps: 0 };
}

export async function processWaveSpeedGeneration(genId: number): Promise<void> {
  try {
    const gen = await db.waveSpeedGeneration.update({
      where: { id: genId },
      data: { status: "processing", progress: 0 },
      include: {
        product: { include: { catalogModel: true } },
      },
    });

    const creds = await getActiveWaveSpeedCredentials();
    if (env.DEMO_MODE || !creds) {
      await sleep(2000);
      await db.waveSpeedGeneration.update({
        where: { id: genId },
        data: {
          status: "succeeded",
          progress: 100,
          resultUrls: JSON.stringify([
            `https://picsum.photos/id/${(genId % 30) + 10}/800/1200`,
          ]),
        },
      });
      return;
    }

    const params = JSON.parse(gen.params || "{}") as Record<string, unknown>;
    let inputs = buildWaveSpeedInputs(gen.product, gen.prompt, params);

    // 若有本地 base64 图，尽量映射到常见字段 image / image_url
    if (typeof params.image_base64 === "string" && params.image_base64.startsWith("data:")) {
      if (!inputs.image && !inputs.image_url) {
        inputs = { ...inputs, image: params.image_base64 };
      }
    }

    await db.waveSpeedGeneration.update({
      where: { id: genId },
      data: { wsAccountId: creds.accountId, status: "processing", progress: 5 },
    });

    const task = await submitWaveSpeedTask(creds.apiKey, gen.product.modelId, inputs);
    await db.waveSpeedGeneration.update({
      where: { id: genId },
      data: { externalId: task.id, progress: 10 },
    });

    let mapped = mapWsStatus(task.status);
    let outputs: string[] = [];
    let lastError: string | undefined;

    for (let i = 0; i < 90; i++) {
      await sleep(i < 10 ? 2000 : 4000);
      const result = await pollWaveSpeedResult(creds.apiKey, task.id);
      mapped = mapWsStatus(result.status);
      outputs = result.outputs;
      lastError = result.error;
      const progress =
        mapped === "succeeded" ? 100 : mapped === "failed" ? gen.progress : Math.min(95, 10 + i * 2);
      await db.waveSpeedGeneration.update({
        where: { id: genId },
        data: {
          status: mapped === "pending" ? "processing" : mapped,
          progress,
          ...(lastError ? { error: lastError.slice(0, 500) } : {}),
        },
      });
      if (mapped === "succeeded" || mapped === "failed") break;
    }

    if (mapped === "succeeded") {
      const finalUrls = await mirrorRemoteUrls(outputs, `plaything/${genId}`);
      await db.waveSpeedGeneration.update({
        where: { id: genId },
        data: {
          status: "succeeded",
          progress: 100,
          resultUrls: JSON.stringify(finalUrls.length ? finalUrls : outputs),
          params: JSON.stringify(
            Object.fromEntries(
              Object.entries(params).filter(([k]) => k !== "image_base64")
            )
          ),
        },
      });
    } else {
      await failAndRefundWaveSpeed(genId, lastError || "WaveSpeed generation timed out or failed");
    }
  } catch (err) {
    console.error(`[wavespeed] generation ${genId} error:`, err);
    await failAndRefundWaveSpeed(
      genId,
      err instanceof Error ? err.message : String(err)
    ).catch(() => {});
  }
}

async function failAndRefundWaveSpeed(genId: number, reason?: string) {
  const claimed = await db.waveSpeedGeneration.updateMany({
    where: { id: genId, status: { not: "failed" } },
    data: {
      status: "failed",
      error: reason?.slice(0, 500),
    },
  });
  if (claimed.count === 0) return;

  const gen = await db.waveSpeedGeneration.findUnique({ where: { id: genId } });
  if (!gen) return;

  await db.$transaction([
    db.user.update({ where: { id: gen.userId }, data: { balance: { increment: gen.cost } } }),
    db.transaction.create({
      data: { userId: gen.userId, type: "refund", amount: gen.cost, method: "plaything" },
    }),
  ]);
  sendTelegram(
    `⚠️ 玩物专区生成失败已退款\n任务 #${genId}\n用户 ID: ${gen.userId}\n退回点数: ${gen.cost}${
      reason ? `\n原因: ${reason.slice(0, 120)}` : ""
    }`
  );
}
