import "server-only";
import { refreshCapabilities } from "../model-capability-store";
import { db } from "../db";
import { env } from "../env";
import { decryptSecret } from "../secret-crypto";
import {
  estimatePricing,
  listRemoteModels as listRemoteWaveSpeedModels,
  pollWaveSpeedResult,
  submitWaveSpeedTask,
  testWaveSpeedKey,
} from "../wavespeed";
import {
  atlasRunPath,
  fetchAtlasSchema,
  listRemoteAtlasModels,
  pollAtlasResult,
  submitAtlasTask,
  testAtlasKey,
} from "../atlas";
import { PROVIDER_IDS, PROVIDER_META, toProviderId, type ProviderId } from "./meta";
import type { ProviderAdapter, ProviderCredentials } from "./types";

export * from "./meta";
export type * from "./types";

/**
 * 渠道注册表。
 *
 * 目标是「加一家上游 = 加一个适配器」：凭据取用、目录同步、提交轮询、
 * 估价降级这四件事的调用方都只认这个接口，不认具体是谁。
 */
const ADAPTERS: Record<ProviderId, ProviderAdapter> = {
  wavespeed: {
    id: "wavespeed",
    getCredentials: () => resolveCredentials("wavespeed"),
    testKey: testWaveSpeedKey,
    envApiKey: () => env.WAVESPEED_API_KEY,
    envBaseUrl: () => env.WAVESPEED_BASE_URL,
    listRemoteModels: async (apiKey) => {
      const remote = await listRemoteWaveSpeedModels(apiKey);
      return remote.map((m) => {
        const modelId = (m.model_id || m.name || "").trim();
        return {
          modelId,
          name: (m.name || modelId).trim(),
          type: (m.type || "").trim(),
          description: (m.description || "").slice(0, 4000),
          basePriceUsd: typeof m.base_price === "number" ? m.base_price : 0,
          thumbnailUrl: pickWaveSpeedThumb(m),
          // WaveSpeed 的 schema 内联在目录里，不需要二次抓取
          apiSchema: m.api_schema != null ? JSON.stringify(m.api_schema) : null,
          schemaUrl: null,
        };
      });
    },
    submit: (apiKey, ctx, inputs) => submitWaveSpeedTask(apiKey, ctx.modelId, inputs),
    poll: pollWaveSpeedResult,
    estimatePrice: estimatePricing,
  },

  atlas: {
    id: "atlas",
    getCredentials: () => resolveCredentials("atlas"),
    testKey: testAtlasKey,
    envApiKey: () => env.ATLAS_API_KEY,
    envBaseUrl: () => env.ATLAS_BASE_URL,
    listRemoteModels: listRemoteAtlasModels,
    fetchSchema: fetchAtlasSchema,
    submit: (apiKey, ctx, inputs) =>
      submitAtlasTask(apiKey, ctx.modelId, inputs, atlasRunPath(ctx.apiSchema, ctx.type)),
    poll: pollAtlasResult,
    // Atlas 没有按入参估价的接口，只有目录上的基准价：
    // 返回 null 让报价退回固定扣点，而不是把生成拦下来
    estimatePrice: async () => null,
  },
};

function pickWaveSpeedThumb(m: {
  cover_url?: string;
  thumbnail_url?: string;
  thumbnail?: string;
}): string | null {
  for (const raw of [m.cover_url, m.thumbnail_url, m.thumbnail]) {
    if (typeof raw === "string" && raw.startsWith("http")) return raw;
  }
  return null;
}

export function getAdapter(provider: unknown): ProviderAdapter {
  return ADAPTERS[toProviderId(provider)];
}

/**
 * 取该渠道当前可用的凭据：优先管理端激活账户，其次 .env 兜底。
 *
 * 「激活」是按渠道各自算的——WaveSpeed 激活一个、Atlas 激活一个，互不影响。
 * 老数据没有 provider 列时 default("wavespeed") 会把它们全部归给 WaveSpeed，
 * 与迁移前的行为一致。
 */
async function resolveCredentials(provider: ProviderId): Promise<ProviderCredentials | null> {
  const active = await db.providerAccount.findFirst({ where: { provider, isActive: true } });
  const meta = ADAPTERS[provider];
  if (active) {
    // 解不开就当这个账户不存在，继续往 .env 兜底走。
    // AUTH_SECRET 轮换过、或密文被改坏时，抛出去会让所有依赖「渠道是否可用」的
    // 接口（含 /api/features）直接 500，而不是安静地降级
    try {
      return {
        provider,
        apiKey: decryptSecret(active.apiKeyEnc),
        baseUrl: meta.envBaseUrl(),
        accountId: active.id,
        source: "db",
        label: active.label,
      };
    } catch (err) {
      console.error(
        `[providers] ${provider} 账户 #${active.id}「${active.label}」的 API Key 解密失败，已回退 .env：`,
        err
      );
    }
  }
  const envKey = meta.envApiKey();
  if (envKey) {
    return {
      provider,
      apiKey: envKey,
      baseUrl: meta.envBaseUrl(),
      accountId: null,
      source: "env",
      label: "env",
    };
  }
  return null;
}

export function getProviderCredentials(provider: unknown): Promise<ProviderCredentials | null> {
  return getAdapter(provider).getCredentials();
}

/** 哪些渠道已经配好 Key，管理端与生成端都要据此提示 */
export async function configuredProviders(): Promise<ProviderId[]> {
  const out: ProviderId[] = [];
  for (const id of PROVIDER_IDS) {
    if (await ADAPTERS[id].getCredentials()) out.push(id);
  }
  return out;
}

/** 任一渠道可用即可生成 */
export async function anyProviderConfigured(): Promise<boolean> {
  return (await configuredProviders()).length > 0;
}

/**
 * 按本次入参估一次单价并回填目录缓存。
 *
 * 拿不到价（渠道不支持、接口失败、没配 Key）一律返回 null——
 * 报价与生成都必须能在没有估价的情况下继续，Atlas 全程走的就是这条路。
 */
export async function estimateUnitPrice(
  providerRaw: unknown,
  modelId: string,
  inputs: Record<string, unknown>
): Promise<number | null> {
  const provider = toProviderId(providerRaw);
  const adapter = ADAPTERS[provider];
  const creds = await adapter.getCredentials();
  if (!creds) return null;

  const price = await adapter.estimatePrice(creds.apiKey, modelId, inputs).catch(() => null);
  if (price != null) {
    await db.providerCatalogModel
      .updateMany({ where: { provider, modelId }, data: { lastUnitPriceUsd: price } })
      .catch(() => undefined);
  }
  return price;
}

export type CatalogSyncResult = {
  provider: ProviderId;
  label: string;
  upserted: number;
  total: number;
  schemasFetched: number;
  schemasFailed: number;
};

/** 同步一次某渠道的全库模型到 ProviderCatalogModel */
export async function syncProviderCatalog(providerRaw: unknown): Promise<CatalogSyncResult> {
  const provider = toProviderId(providerRaw);
  const adapter = ADAPTERS[provider];
  const meta = PROVIDER_META[provider];

  const creds = await adapter.getCredentials();
  if (!creds) {
    throw new Error(`未配置 ${meta.label} API Key，请先在管理端添加并激活`);
  }

  const remote = await adapter.listRemoteModels(creds.apiKey);

  // 上游把 schema 放独立文件时（Atlas 三百多个），逐个抓一遍。
  // 只抓「新模型 / schema 地址变了 / 上次没抓到」的，否则每次同步都要几百个请求。
  let schemasFetched = 0;
  let schemasFailed = 0;
  if (adapter.fetchSchema) {
    const existing = await db.providerCatalogModel.findMany({
      where: { provider, modelId: { in: remote.map((m) => m.modelId) } },
      select: { modelId: true, schemaUrl: true, apiSchema: true },
    });
    const byId = new Map(existing.map((e) => [e.modelId, e]));
    const pending = remote.filter((m) => {
      if (!m.schemaUrl) return false;
      const prev = byId.get(m.modelId);
      return !prev?.apiSchema || prev.schemaUrl !== m.schemaUrl;
    });

    const results = await mapWithConcurrency(pending, 8, async (m) => {
      const schema = await adapter.fetchSchema!(m.schemaUrl!);
      m.apiSchema = schema;
      return schema != null;
    });
    schemasFetched = results.filter(Boolean).length;
    schemasFailed = results.length - schemasFetched;

    // 未进入本轮抓取的模型沿用库里已有的 schema，避免被 null 覆盖
    for (const m of remote) {
      if (m.apiSchema == null) m.apiSchema = byId.get(m.modelId)?.apiSchema ?? null;
    }
  }

  const now = new Date();
  let upserted = 0;
  for (const m of remote) {
    if (!m.modelId) continue;
    // update 里刻意不含 tags：手工贴的标签必须扛过每一次目录同步
    await db.providerCatalogModel.upsert({
      where: { provider_modelId: { provider, modelId: m.modelId } },
      create: {
        provider,
        modelId: m.modelId,
        name: m.name,
        type: m.type,
        description: m.description,
        basePriceUsd: m.basePriceUsd,
        thumbnailUrl: m.thumbnailUrl,
        apiSchema: m.apiSchema,
        schemaUrl: m.schemaUrl ?? null,
        tags: "[]",
        syncedAt: now,
      },
      update: {
        name: m.name,
        type: m.type,
        description: m.description,
        basePriceUsd: m.basePriceUsd,
        ...(m.thumbnailUrl ? { thumbnailUrl: m.thumbnailUrl } : {}),
        ...(m.apiSchema ? { apiSchema: m.apiSchema } : {}),
        schemaUrl: m.schemaUrl ?? null,
        syncedAt: now,
      },
    });
    upserted += 1;
  }

  /*
   * 目录落库之后顺手把能力档案刷一遍。
   * 放在这里而不是运行期：同一份 schema 现在每组一次 catalog 响应就要解析一遍，
   * 而它一天也变不了几次。人工覆盖过的记录只会被标记待复核，不会被冲掉。
   */
  try {
    const caps = await refreshCapabilities(provider);
    console.log(
      `[sync:${provider}] 能力档案：新派生 ${caps.derived} · 跳过 ${caps.skipped} · 标记待复核 ${caps.markedStale}`
    );
  } catch (err) {
    // 能力派生失败不该让整轮目录同步作废——目录本身已经落库了
    console.error(`[sync:${provider}] 能力档案刷新失败：`, err);
  }

  return {
    provider,
    label: meta.label,
    upserted,
    total: remote.length,
    schemasFetched,
    schemasFailed,
  };
}

/** 限并发的 map：几百个 schema 文件一次性打出去会被上游限流 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * 上游状态 → 站内状态。
 *
 * 两家的取值有重叠也有差异（WaveSpeed 用 completed，Atlas 也用 completed，
 * 但 Atlas 没有 queued），统一在这里收敛，未知值一律按处理中而不是失败——
 * 把没跑完的任务判成失败会触发误退款。
 */
export function mapProviderStatus(
  status: string
): "pending" | "processing" | "succeeded" | "failed" {
  const s = status.toLowerCase();
  if (["completed", "succeeded", "success", "done", "finished"].includes(s)) return "succeeded";
  if (["failed", "error", "cancelled", "canceled", "timeout"].includes(s)) return "failed";
  if (["created", "queued", "pending", "starting", "submitted"].includes(s)) return "pending";
  return "processing";
}
