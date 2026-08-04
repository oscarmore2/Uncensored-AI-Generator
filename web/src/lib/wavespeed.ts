import "server-only";
import { env } from "./env";
import type { PollResult, SubmitResult } from "./providers/types";

/**
 * WaveSpeed.ai 上游客户端。
 *
 * 这里只放「怎么和 WaveSpeed 说话」，不碰数据库、不做编排——
 * 凭据取用、目录落库、任务编排都在 providers/index.ts 与 plaything-runner.ts，
 * 那两处对渠道是无差别的。否则每加一家上游都要把编排逻辑再抄一遍。
 */

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

/** 轻量校验：拉一次模型列表 */
export async function testWaveSpeedKey(apiKey: string): Promise<void> {
  await wavespeedFetch(apiKey, "/models");
}

export async function listRemoteModels(apiKey: string): Promise<RemoteWaveSpeedModel[]> {
  const data = await wavespeedFetch<RemoteWaveSpeedModel[] | { items?: RemoteWaveSpeedModel[] }>(
    apiKey,
    "/models"
  );
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

/** 按本次入参估价（美元）；失败返回 null，交给调用方退回基准价 */
export async function estimatePricing(
  apiKey: string,
  modelId: string,
  inputs: Record<string, unknown>
): Promise<number | null> {
  try {
    const data = await wavespeedFetch<{
      unit_price?: number;
      price?: number;
      model_id?: string;
      currency?: string;
    }>(apiKey, "/model/pricing", {
      method: "POST",
      body: JSON.stringify({ model_id: modelId, inputs }),
    });
    if (typeof data?.unit_price === "number") return data.unit_price;
    if (typeof data?.price === "number") return data.price;
    return null;
  } catch {
    return null;
  }
}

export async function submitWaveSpeedTask(
  apiKey: string,
  modelId: string,
  inputs: Record<string, unknown>
): Promise<SubmitResult> {
  const data = await wavespeedFetch<{ id?: string; status?: string }>(
    apiKey,
    `/${modelId}`,
    { method: "POST", body: JSON.stringify(inputs) }
  );
  const id = data?.id;
  if (!id) throw new Error("WaveSpeed 未返回任务 ID");
  return { id, status: data.status || "created" };
}

export async function pollWaveSpeedResult(apiKey: string, taskId: string): Promise<PollResult> {
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
  return {
    status,
    outputs: normalizeOutputs(rawOutputs),
    thumbnails: normalizeThumbnails(rawOutputs),
    error: err ? String(err) : undefined,
  };
}

/**
 * 成品缩略图的防御性解析。WaveSpeed 的 predictions 返回体目前只有
 * id / status / outputs / timings，outputs 就是成品 URL，没有缩略图字段；
 * 这里把常见命名都试一遍，哪天上游补上了就自动生效，取不到也不影响主流程。
 */
function normalizeThumbnails(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const urls: string[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const t = o.thumbnail ?? o.thumbnail_url ?? o.preview ?? o.preview_url ?? o.poster ?? o.cover;
    if (typeof t === "string" && t.startsWith("http")) urls.push(t);
  }
  return urls;
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
