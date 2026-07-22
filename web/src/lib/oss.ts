import "server-only";
import { PutObjectCommand, HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "./env";
import { db } from "./db";
import { decryptSecret } from "./secret-crypto";

export interface OssConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string | null;
  pathPrefix: string;
  mirrorZenResults: boolean;
  forcePathStyle: boolean;
  accountRefId: number | null;
  source: "db" | "env";
  label?: string;
}

function normalizeEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  if (!trimmed) return trimmed;
  return trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
}

function providerDefaults(provider: string): { forcePathStyle: boolean; region: string } {
  switch (provider) {
    case "minio":
      return { forcePathStyle: true, region: "us-east-1" };
    case "aliyun":
      return { forcePathStyle: false, region: "oss-cn-hangzhou" };
    case "r2":
      return { forcePathStyle: false, region: "auto" };
    default:
      return { forcePathStyle: false, region: "us-east-1" };
  }
}

/** 优先使用管理端激活的 OSS 账户；无激活时回退到 .env */
export async function getActiveOssConfig(): Promise<OssConfig | null> {
  const active = await db.ossAccount.findFirst({ where: { isActive: true } });
  if (active) {
    const defaults = providerDefaults(active.provider);
    return {
      endpoint: normalizeEndpoint(active.endpoint),
      region: active.region || defaults.region,
      bucket: active.bucket,
      accessKeyId: active.accessKeyId,
      secretAccessKey: decryptSecret(active.secretAccessKeyEnc),
      publicBaseUrl: active.publicBaseUrl?.replace(/\/+$/, "") || null,
      pathPrefix: active.pathPrefix.replace(/^\/+|\/+$/g, "") || "media",
      mirrorZenResults: active.mirrorZenResults,
      forcePathStyle: active.forcePathStyle ?? defaults.forcePathStyle,
      accountRefId: active.id,
      source: "db",
      label: active.label,
    };
  }

  if (env.OSS_ENDPOINT && env.OSS_BUCKET && env.OSS_ACCESS_KEY_ID && env.OSS_SECRET_ACCESS_KEY) {
    return {
      endpoint: normalizeEndpoint(env.OSS_ENDPOINT),
      region: env.OSS_REGION,
      bucket: env.OSS_BUCKET,
      accessKeyId: env.OSS_ACCESS_KEY_ID,
      secretAccessKey: env.OSS_SECRET_ACCESS_KEY,
      publicBaseUrl: env.OSS_PUBLIC_BASE_URL?.replace(/\/+$/, "") || null,
      pathPrefix: env.OSS_PATH_PREFIX.replace(/^\/+|\/+$/g, "") || "media",
      mirrorZenResults: env.OSS_MIRROR_ZEN_RESULTS,
      forcePathStyle: env.OSS_FORCE_PATH_STYLE,
      accountRefId: null,
      source: "env",
      label: "env",
    };
  }
  return null;
}

export async function ossConfigured(): Promise<boolean> {
  return Boolean(await getActiveOssConfig());
}

function createS3Client(config: OssConfig): S3Client {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: config.forcePathStyle,
  });
}

export function buildObjectKey(config: OssConfig, relativePath: string): string {
  const rel = relativePath.replace(/^\/+/, "");
  return config.pathPrefix ? `${config.pathPrefix}/${rel}` : rel;
}

export function publicUrlForKey(config: OssConfig, key: string): string {
  if (config.publicBaseUrl) {
    return `${config.publicBaseUrl}/${key}`;
  }
  const endpoint = config.endpoint.replace(/^https?:\/\//, "");
  if (config.forcePathStyle) {
    return `${config.endpoint}/${config.bucket}/${key}`;
  }
  return `https://${config.bucket}.${endpoint}/${key}`;
}

function guessExtension(url: string, contentType: string | null): string {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.([a-zA-Z0-9]{2,5})$/);
    if (match) return match[1].toLowerCase();
  } catch {
    // ignore
  }
  if (contentType?.includes("video")) return "mp4";
  if (contentType?.includes("png")) return "png";
  if (contentType?.includes("webp")) return "webp";
  return "jpg";
}

/** 上传 Buffer 到 OSS，返回公网 URL */
export async function uploadBuffer(
  buffer: Buffer,
  relativePath: string,
  contentType: string,
  config?: OssConfig
): Promise<string> {
  const cfg = config ?? (await getActiveOssConfig());
  if (!cfg) throw new Error("OSS is not configured");

  const key = buildObjectKey(cfg, relativePath);
  const client = createS3Client(cfg);
  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );
  return publicUrlForKey(cfg, key);
}

/** 从远程 URL 下载并上传到 OSS */
export async function uploadFromUrl(remoteUrl: string, relativePath: string, config?: OssConfig): Promise<string> {
  const resp = await fetch(remoteUrl);
  if (!resp.ok) {
    throw new Error(`Failed to fetch ${remoteUrl}: HTTP ${resp.status}`);
  }
  const contentType = resp.headers.get("content-type") ?? "application/octet-stream";
  const buffer = Buffer.from(await resp.arrayBuffer());
  return uploadBuffer(buffer, relativePath, contentType, config);
}

/**
 * 将 Zen/外部 URL 列表镜像到 OSS。
 * 未配置 OSS 或 mirrorZenResults=false 时原样返回。
 */
export async function mirrorRemoteUrls(
  urls: string[],
  keyPrefix: string,
  config?: OssConfig
): Promise<string[]> {
  const cfg = config ?? (await getActiveOssConfig());
  if (!cfg || !cfg.mirrorZenResults) return urls;

  const mirrored: string[] = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    if (!url) continue;
    // 已在自家 OSS/CDN 上的 URL 跳过
    if (cfg.publicBaseUrl && url.startsWith(cfg.publicBaseUrl)) {
      mirrored.push(url);
      continue;
    }
    try {
      const ext = guessExtension(url, null);
      const rel = `${keyPrefix}/${i}.${ext}`;
      const publicUrl = await uploadFromUrl(url, rel, cfg);
      mirrored.push(publicUrl);
    } catch (err) {
      console.warn(`[oss] mirror failed for ${url}:`, err);
      mirrored.push(url);
    }
  }
  return mirrored;
}

/** 连通性测试：HeadBucket */
export async function testOssConnection(config: OssConfig): Promise<{ ok: true; bucket: string }> {
  const client = createS3Client(config);
  await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
  return { ok: true, bucket: config.bucket };
}

/** 从 DB 记录构建 OssConfig（管理端测试用） */
export async function ossConfigFromAccountId(accountId: number): Promise<OssConfig> {
  const account = await db.ossAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new Error("OSS account not found");
  const defaults = providerDefaults(account.provider);
  return {
    endpoint: normalizeEndpoint(account.endpoint),
    region: account.region || defaults.region,
    bucket: account.bucket,
    accessKeyId: account.accessKeyId,
    secretAccessKey: decryptSecret(account.secretAccessKeyEnc),
    publicBaseUrl: account.publicBaseUrl?.replace(/\/+$/, "") || null,
    pathPrefix: account.pathPrefix.replace(/^\/+|\/+$/g, "") || "media",
    mirrorZenResults: account.mirrorZenResults,
    forcePathStyle: account.forcePathStyle ?? defaults.forcePathStyle,
    accountRefId: account.id,
    source: "db",
    label: account.label,
  };
}
