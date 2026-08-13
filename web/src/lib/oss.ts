import "server-only";
import { DeleteObjectCommand, PutObjectCommand, HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
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
  mirrorResults: boolean;
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
      mirrorResults: active.mirrorResults,
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
      mirrorResults: env.OSS_MIRROR_RESULTS,
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

/**
 * 从远程 URL 提取可用作 OSS 文件名的原始 basename（不含扩展名，已消毒）。
 * 取不到就返回 null，调用方回退到序号命名。
 */
export function guessBasename(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    const last = pathname.split("/").filter(Boolean).pop();
    if (!last) return null;
    const withoutExt = last.replace(/\.[a-zA-Z0-9]{2,5}$/, "");
    // 只保留安全字符，防止路径穿越 / 特殊字符进对象 key
    const safe = withoutExt.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
    return safe || null;
  } catch {
    return null;
  }
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

export async function uploadBufferWithMeta(
  buffer: Buffer,
  relativePath: string,
  contentType: string,
  config?: OssConfig
): Promise<{ url: string; objectKey: string; config: OssConfig }> {
  const cfg = config ?? (await getActiveOssConfig());
  if (!cfg) throw new Error("OSS is not configured");
  const objectKey = buildObjectKey(cfg, relativePath);
  const url = await uploadBuffer(buffer, relativePath, contentType, cfg);
  return { url, objectKey, config: cfg };
}

export async function deleteObjectKey(objectKey: string, config?: OssConfig): Promise<void> {
  const cfg = config ?? (await getActiveOssConfig());
  if (!cfg) throw new Error("OSS is not configured");
  const client = createS3Client(cfg);
  await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: objectKey }));
}

export function objectKeyFromPublicUrl(config: OssConfig, mediaUrl: string): string | null {
  try {
    const url = new URL(mediaUrl);
    if (config.publicBaseUrl) {
      const base = new URL(config.publicBaseUrl);
      if (url.origin === base.origin && url.pathname.startsWith(`${base.pathname.replace(/\/$/, "")}/`)) {
        return decodeURIComponent(url.pathname.slice(base.pathname.replace(/\/$/, "").length + 1));
      }
    }
    const endpoint = new URL(config.endpoint);
    if (config.forcePathStyle && url.origin === endpoint.origin) {
      const prefix = `/${config.bucket}/`;
      return url.pathname.startsWith(prefix) ? decodeURIComponent(url.pathname.slice(prefix.length)) : null;
    }
    if (url.hostname === `${config.bucket}.${endpoint.hostname}`) {
      return decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    }
  } catch {
    return null;
  }
  return null;
}

/** 只删除当前激活 OSS 所管理的 URL；外部供应商 URL 返回 false。 */
export async function deleteManagedMediaUrl(mediaUrl: string): Promise<boolean> {
  const config = await getActiveOssConfig();
  if (!config) return false;
  const key = objectKeyFromPublicUrl(config, mediaUrl);
  if (!key) return false;
  await deleteObjectKey(key, config);
  return true;
}

/**
 * 镜像单个文件的体积上限。
 * 3D 生成结果（尤其是带 PBR 材质的 GLB：贴图+法线+粗糙度/金属度多张贴图叠在一个二进制里）
 * 比普通图片大得多，容易超过一般图片/视频的体积——超限会静默跳过镜像、
 * 回退到上游可能过期或跨域受限的原始链接，这类文件反而最该被镜像下来。
 */
const MIRROR_MAX_BYTES = 100 * 1024 * 1024;

/** 从远程 URL 下载并上传到 OSS（带 SSRF 防护） */
export async function uploadFromUrl(remoteUrl: string, relativePath: string, config?: OssConfig): Promise<string> {
  const { assertSafeRemoteMediaUrl } = await import("./safe-url");
  const cfg = config ?? (await getActiveOssConfig());
  const extra = cfg?.publicBaseUrl
    ? (() => {
        try {
          return [new URL(cfg.publicBaseUrl).hostname];
        } catch {
          return [] as string[];
        }
      })()
    : [];
  await assertSafeRemoteMediaUrl(remoteUrl, { extraHostSuffixes: extra });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const resp = await fetch(remoteUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: { Accept: "image/*,video/*,model/*,*/*" },
    });
    if (!resp.ok) {
      throw new Error(`Failed to fetch remote media: HTTP ${resp.status}`);
    }
    const contentType = resp.headers.get("content-type") ?? "application/octet-stream";
    const len = Number(resp.headers.get("content-length") ?? 0);
    if (len > MIRROR_MAX_BYTES) {
      throw new Error(`Remote media too large (${(len / 1024 / 1024).toFixed(1)}MB)`);
    }
    const buffer = Buffer.from(await resp.arrayBuffer());
    if (buffer.length > MIRROR_MAX_BYTES) {
      throw new Error(`Remote media too large (${(buffer.length / 1024 / 1024).toFixed(1)}MB)`);
    }
    return uploadBuffer(buffer, relativePath, contentType, config);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 将上游/外部 URL 列表镜像到 OSS。
 * 未配置 OSS 或 mirrorResults=false 时原样返回。
 */
export async function mirrorRemoteUrls(
  urls: string[],
  keyPrefix: string,
  config?: OssConfig
): Promise<string[]> {
  const cfg = config ?? (await getActiveOssConfig());
  if (!cfg || !cfg.mirrorResults) return urls;

  const mirrored: string[] = [];
  const usedNames = new Set<string>();
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
      // 保留原始文件名（而非纯序号）：3D 生成常见输出是 .gltf + .bin + 贴图的组合，
      // 内部靠相对文件名互相引用；同一次生成的文件仍放在同一个 keyPrefix 目录下，
      // 只要文件名不变，镜像后这些相对引用照样能解析，贴图不会因为改名而丢失。
      // 去重判定必须带上扩展名——mesh.gltf 和 mesh.bin 同名不同缀是正常情况，
      // 只按 basename 去重会把 mesh.bin 错误地改名成 mesh_1.bin，反而破坏引用。
      const base = guessBasename(url);
      let name = base ?? String(i);
      let filename = `${name}.${ext}`;
      if (usedNames.has(filename)) {
        name = `${name}_${i}`;
        filename = `${name}.${ext}`;
      }
      usedNames.add(filename);
      const rel = `${keyPrefix}/${filename}`;
      const publicUrl = await uploadFromUrl(url, rel, cfg);
      mirrored.push(publicUrl);
    } catch (err) {
      console.warn(`[oss] mirror failed for ${url}:`, err);
      mirrored.push(url);
    }
  }
  return mirrored;
}

/**
 * 镜像到自家 OSS，并逐条确认真的落地了。
 *
 * mirrorRemoteUrls 在任何一步失败时都会静默回落到上游直链——对普通生成结果
 * 这是对的（宁可留个能看的链接，也别把结果整个丢掉），但对「公共库」这种
 * 要长期挂在站上的东西就是隐患：上游一清理就是一片裂图，而且事后无从补救。
 *
 * 所以曝光/导入这类路径改用这个，把失败暴露给调用方去拒绝写库。
 * OSS 没配或没开镜像时不拦——那种情况下本来就没得选。
 */
export async function mirrorForPermanentUse(
  urls: string[],
  keyPrefix: string
): Promise<{ urls: string[]; unmirrored: string[] }> {
  const cfg = await getActiveOssConfig();
  const mirrored = await mirrorRemoteUrls(urls, keyPrefix, cfg ?? undefined);
  if (!cfg || !cfg.mirrorResults) return { urls: mirrored, unmirrored: [] };
  const unmirrored = mirrored.filter((u) => objectKeyFromPublicUrl(cfg, u) === null);
  return { urls: mirrored, unmirrored };
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
    mirrorResults: account.mirrorResults,
    forcePathStyle: account.forcePathStyle ?? defaults.forcePathStyle,
    accountRefId: account.id,
    source: "db",
    label: account.label,
  };
}
