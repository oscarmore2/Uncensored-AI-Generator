import "server-only";
import { env } from "./env";
import type { PollResult, RemoteModel, SubmitResult } from "./providers/types";

/**
 * Atlas Cloud（atlascloud.ai）上游客户端。
 *
 * 与 WaveSpeed 的差异，都是这一层要吃掉的：
 * 1. 提交端点按媒体类型分三个（generateImage / generateVideo / generateAudio），
 *    而且 model 要放在 body 里而不是路径上；
 * 2. 目录接口只给 schema 文件的 URL，参数 schema 要再抓一次，而且是
 *    OpenAPI 3.0 文档（components.schemas.Input），不是 WaveSpeed 那种 api_schemas；
 * 3. 没有按入参实时估价的接口，只有目录上的基准价。
 *
 * 信封与 WaveSpeed 同形（{code, msg, data}），但 code 有时是数字有时是字符串。
 */

const MEDIA_TYPES = new Set(["image", "video", "audio"]);

/** 目录接口返回体（只声明我们用得到的字段） */
type AtlasRemoteModel = {
  model?: string;
  displayName?: string;
  type?: string; // Text | Image | Video | Audio
  profile?: string;
  coverUrl?: string;
  background?: string;
  logo?: string;
  schema?: string;
  categories?: string[] | null;
  tags?: string[] | null;
  price?: { actual?: { base_price?: string | number } | null } | null;
};

type AtlasEnvelope<T> = {
  code?: number | string;
  msg?: string;
  message?: string;
  data?: T;
};

function baseUrl(): string {
  return env.ATLAS_BASE_URL.replace(/\/$/, "");
}

export async function atlasFetch<T = unknown>(
  apiKey: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const url = path.startsWith("http") ? path : `${baseUrl()}${path.startsWith("/") ? "" : "/"}${path}`;
  const resp = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await resp.text().catch(() => "");
  let json: AtlasEnvelope<T> | null = null;
  try {
    json = text ? (JSON.parse(text) as AtlasEnvelope<T>) : null;
  } catch {
    json = null;
  }
  const msg = json?.msg || json?.message || "";
  if (!resp.ok) {
    throw new Error(`Atlas Cloud ${resp.status}: ${(msg || text || resp.statusText).slice(0, 300)}`);
  }
  // code 在不同端点上分别是 200 与 "200"，统一按数字比
  if (json?.code !== undefined && Number(json.code) !== 200) {
    throw new Error(`Atlas Cloud API: ${(msg || `code ${json.code}`).slice(0, 300)}`);
  }
  return (json?.data !== undefined ? json.data : (json as unknown as T)) as T;
}

/**
 * 轻量校验 Key。
 *
 * 目录接口不鉴权（不带 Key 也返回 200），拿它当校验等于永远通过，
 * 所以改用会鉴权的 /model/prediction/{id}：Key 无效返回 401，
 * Key 有效但任务不存在返回 404 / 业务错误——后者才说明 Key 是通的。
 */
export async function testAtlasKey(apiKey: string): Promise<void> {
  const probe = "atlas-key-probe-000000000000";
  const resp = await fetch(`${baseUrl()}/model/prediction/${probe}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (resp.status === 401 || resp.status === 403) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Atlas Cloud 拒绝该 Key（${resp.status}）：${text.slice(0, 200)}`);
  }
  // 其余状态（含 404 / 业务错误）都说明鉴权已通过
}

export async function listRemoteAtlasModels(apiKey: string): Promise<RemoteModel[]> {
  const data = await atlasFetch<AtlasRemoteModel[] | { items?: AtlasRemoteModel[] }>(
    apiKey,
    "/models"
  );
  const rows = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];

  const out: RemoteModel[] = [];
  for (const m of rows) {
    const modelId = (m.model || "").trim();
    if (!modelId) continue;
    // 纯文本 LLM 与本站无关（本站不做对话），同步进来只会把模型库淹掉
    if (!MEDIA_TYPES.has(String(m.type || "").toLowerCase())) continue;

    out.push({
      modelId,
      name: (m.displayName || modelId).trim(),
      // 用 TEXT-TO-VIDEO 这类细分类目当 type：玩物专区的品类归类正是按这个字符串匹配的，
      // 只给 "Video" 会让图生视频与文生视频糊成一类
      type: resolveAtlasType(m),
      description: (m.profile || "").slice(0, 4000),
      basePriceUsd: parsePrice(m.price?.actual?.base_price),
      thumbnailUrl: pickThumbnail(m),
      schemaUrl: typeof m.schema === "string" && m.schema.startsWith("http") ? m.schema : null,
      apiSchema: null, // 单独抓取，见 syncProviderCatalog
      remoteTags: (m.tags ?? []).filter((t): t is string => typeof t === "string"),
    });
  }
  return out;
}

function resolveAtlasType(m: AtlasRemoteModel): string {
  const cat = (m.categories ?? []).find((c) => typeof c === "string" && c.trim());
  if (cat) return normalizeCategory(cat);

  // categories 可能为 null（reference-to-video 与少数几个模型），此时细分类目在 tags 里。
  // 分隔符两种都有：IMAGE-TO-VIDEO 与 IMAGE_TO_VIDEO，两种都要认
  const tag = (m.tags ?? []).find((t) => typeof t === "string" && /[-_]TO[-_]/i.test(t));
  if (tag) return normalizeCategory(tag);

  // 最后从 model_id 里认：ltx-2.3-quality/image-to-video 这类光看 type 只能得到 "Video"，
  // 归类会粗到把文生视频和图生视频混成一档
  const fromId = m.model?.match(/(text|image|video|audio|reference|speech)[-_]to[-_](image|video|audio|text|3d)/i);
  if (fromId) return normalizeCategory(fromId[0]);

  return (m.type || "").trim();
}

function normalizeCategory(raw: string): string {
  return raw.trim().replace(/_/g, "-").toUpperCase();
}

function pickThumbnail(m: AtlasRemoteModel): string | null {
  for (const raw of [m.coverUrl, m.background, m.logo]) {
    if (typeof raw === "string" && raw.startsWith("http")) return raw;
  }
  return null;
}

function parsePrice(raw: unknown): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** 抓取单个模型的 OpenAPI schema 文件；失败返回 null，不阻断整轮同步 */
export async function fetchAtlasSchema(schemaUrl: string): Promise<string | null> {
  try {
    const resp = await fetch(schemaUrl, { headers: { Accept: "application/json" } });
    if (!resp.ok) return null;
    const text = await resp.text();
    if (!text.trim()) return null;
    JSON.parse(text); // 存之前先确认是合法 JSON，避免污染 apiSchema
    return text;
  } catch {
    return null;
  }
}

/**
 * 从模型自带的 OpenAPI 文档里读出提交端点。
 *
 * 不按模型类型硬猜 generateImage / generateVideo：同为 Video 类的
 * tencent/video/upscaler 与 minimax/h3 走的是同一个端点，但 Audio 类里
 * 语音识别与语音合成也都在 generateAudio——真正可靠的只有 schema 里
 * 那条标了 x-api-name: model_run 的 path。
 */
export function atlasRunPath(apiSchema: string | null | undefined, type: string): string {
  const fromSchema = runPathFromSchema(apiSchema);
  if (fromSchema) return fromSchema;

  const t = (type || "").toLowerCase();
  if (/video/.test(t)) return "/model/generateVideo";
  if (/audio|speech|voice|music/.test(t)) return "/model/generateAudio";
  return "/model/generateImage";
}

function runPathFromSchema(apiSchema: string | null | undefined): string | null {
  if (!apiSchema) return null;
  try {
    const root = JSON.parse(apiSchema) as {
      paths?: Record<string, Record<string, { "x-api-name"?: string }> & { "x-api-name"?: string }>;
    };
    const paths = root.paths ?? {};
    let firstPost: string | null = null;
    for (const [path, item] of Object.entries(paths)) {
      if (!item || typeof item !== "object") continue;
      const post = (item as Record<string, { "x-api-name"?: string } | undefined>).post;
      if (!post) continue;
      firstPost ??= path;
      const apiName = post["x-api-name"] ?? item["x-api-name"];
      if (apiName === "model_run") return normalizeRunPath(path);
    }
    return firstPost ? normalizeRunPath(firstPost) : null;
  } catch {
    return null;
  }
}

/** schema 里的 path 是从站点根算起的 /api/v1/...，而 baseUrl 已含 /api/v1 */
function normalizeRunPath(path: string): string {
  return path.replace(/^\/api\/v1(?=\/)/, "") || "/model/generateImage";
}

export async function submitAtlasTask(
  apiKey: string,
  modelId: string,
  inputs: Record<string, unknown>,
  runPath: string
): Promise<SubmitResult> {
  const data = await atlasFetch<{ id?: string; status?: string }>(apiKey, runPath, {
    method: "POST",
    // model 由这里权威写入：schema 的 default 可能是过期的别名
    body: JSON.stringify({ ...inputs, model: modelId }),
  });
  const id = data?.id;
  if (!id) throw new Error("Atlas Cloud 未返回任务 ID");
  return { id, status: data.status || "created" };
}

export async function pollAtlasResult(apiKey: string, taskId: string): Promise<PollResult> {
  const data = await atlasFetch<{
    status?: string;
    outputs?: unknown;
    output?: unknown;
    error?: string;
  }>(apiKey, `/model/prediction/${encodeURIComponent(taskId)}`);

  const raw = data?.outputs ?? data?.output ?? [];
  return {
    status: String(data?.status || "processing").toLowerCase(),
    outputs: normalizeOutputs(raw),
    thumbnails: [],
    error: data?.error ? String(data.error) : undefined,
  };
}

function normalizeOutputs(raw: unknown): string[] {
  if (!raw) return [];
  if (typeof raw === "string") return raw.startsWith("http") ? [raw] : [];
  if (!Array.isArray(raw)) return [];
  const urls: string[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.startsWith("http")) urls.push(item);
    else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const u = o.url || o.download_url || o.image || o.video || o.audio;
      if (typeof u === "string" && u.startsWith("http")) urls.push(u);
    }
  }
  return urls;
}
