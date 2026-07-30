/** 浏览器端媒体预检（尺寸 / 时长）+ 生成时上传 */

import type { MediaFieldPolicy } from "./plaything-param-policy";

export type ClientMediaMeta = {
  width: number;
  height: number;
  duration_sec?: number;
  contentType: string;
};

export type PendingMedia = {
  id: string;
  file: File;
  previewUrl: string;
  kind: "image" | "video" | "audio";
  meta: ClientMediaMeta;
};

export function readImageMeta(file: File): Promise<ClientMediaMeta> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({
        width: img.naturalWidth,
        height: img.naturalHeight,
        contentType: file.type || "image/jpeg",
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("无法读取图片"));
    };
    img.src = url;
  });
}

export function readVideoMeta(file: File): Promise<ClientMediaMeta> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const duration_sec = video.duration;
      const width = video.videoWidth;
      const height = video.videoHeight;
      URL.revokeObjectURL(url);
      if (!Number.isFinite(duration_sec) || duration_sec <= 0) {
        reject(new Error("无法读取视频时长"));
        return;
      }
      resolve({
        width,
        height,
        duration_sec,
        contentType: file.type || "video/mp4",
      });
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("无法读取视频"));
    };
    video.src = url;
  });
}

export function readAudioMeta(file: File): Promise<ClientMediaMeta> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      const duration_sec = audio.duration;
      URL.revokeObjectURL(url);
      resolve({
        width: 0,
        height: 0,
        duration_sec: Number.isFinite(duration_sec) ? duration_sec : undefined,
        contentType: file.type || "audio/mpeg",
      });
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("无法读取音频"));
    };
    audio.src = url;
  });
}

function mimeAllowed(fileType: string, accept?: string[]): boolean {
  if (!accept?.length) return true;
  if (!fileType) return false;
  const t = fileType.split(";")[0].trim();
  if (accept.includes(t)) return true;
  return accept.some((a) => t.startsWith(a.split("/")[0] + "/"));
}

/** 选择文件时：本地预检，不上传 */
export async function createPendingMedia(opts: {
  file: File;
  kind: "image" | "video" | "audio";
  policy: MediaFieldPolicy;
}): Promise<PendingMedia> {
  const { file, kind, policy } = opts;
  if (!mimeAllowed(file.type, policy.accept)) {
    throw new Error(`文件类型 ${file.type || "未知"} 不在允许列表`);
  }
  const maxBytes = policy.maxBytes ?? (kind === "video" ? 100 * 1024 * 1024 : 15 * 1024 * 1024);
  if (file.size > maxBytes) {
    throw new Error(`文件过大（上限 ${Math.round(maxBytes / 1024 / 1024)}MB）`);
  }

  let meta: ClientMediaMeta;
  if (kind === "image") meta = await readImageMeta(file);
  else if (kind === "video") meta = await readVideoMeta(file);
  else meta = await readAudioMeta(file);

  if (kind === "image" || kind === "video") {
    if (policy.minWidth && meta.width < policy.minWidth) {
      throw new Error(`宽度过小（最小 ${policy.minWidth}px）`);
    }
    if (policy.minHeight && meta.height < policy.minHeight) {
      throw new Error(`高度过小（最小 ${policy.minHeight}px）`);
    }
    if (policy.maxWidth && meta.width > policy.maxWidth) {
      throw new Error(`宽度过大（最大 ${policy.maxWidth}px）`);
    }
    if (policy.maxHeight && meta.height > policy.maxHeight) {
      throw new Error(`高度过大（最大 ${policy.maxHeight}px）`);
    }
  }
  if (kind === "video") {
    const maxDur = policy.maxDurationSec ?? 30;
    if (meta.duration_sec != null && meta.duration_sec > maxDur + 0.25) {
      throw new Error(`视频过长（最长 ${maxDur} 秒）`);
    }
  }

  const previewUrl = URL.createObjectURL(file);
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    file,
    previewUrl,
    kind,
    meta,
  };
}

/**
 * 存草稿用的形态：去掉 previewUrl —— 那是 URL.createObjectURL 的产物，
 * 只在当前文档存活，刷新后一定是死链，必须由 File 重新生成。
 */
export type StoredMedia = Omit<PendingMedia, "previewUrl">;

export function toStoredMedia(items: PendingMedia[]): StoredMedia[] {
  return items.map(({ id, file, kind, meta }) => ({ id, file, kind, meta }));
}

/** 从草稿恢复：重新挂 objectURL，其余原样带回 */
export function restorePendingMedia(items: StoredMedia[]): PendingMedia[] {
  const out: PendingMedia[] = [];
  for (const it of items) {
    // 结构化克隆理论上还原得出 File，但存进去的是别的东西时不要让整页崩掉
    const file: unknown = it?.file;
    if (!(file instanceof Blob)) continue;
    out.push({ ...it, previewUrl: URL.createObjectURL(file) });
  }
  return out;
}

export function revokePendingMedia(items: PendingMedia[]) {
  for (const m of items) {
    try {
      URL.revokeObjectURL(m.previewUrl);
    } catch {
      /* ignore */
    }
  }
}

/** 点击生成时上传到 OSS */
export async function uploadPlaythingFile(opts: {
  file: File;
  kind: "image" | "video" | "audio";
  productId: number;
  field: string;
  meta: ClientMediaMeta;
  accept?: string[];
}): Promise<{
  url: string;
  content_type: string;
  bytes: number;
  width: number | null;
  height: number | null;
  duration_sec: number | null;
}> {
  const { file, kind, productId, field, meta, accept } = opts;
  if (!mimeAllowed(file.type, accept)) {
    throw new Error(`文件类型 ${file.type || "未知"} 不在允许列表`);
  }

  const fd = new FormData();
  fd.set("file", file);
  fd.set("kind", kind);
  fd.set("field", field);
  fd.set("product_id", String(productId));
  if (meta.width) fd.set("width", String(meta.width));
  if (meta.height) fd.set("height", String(meta.height));
  if (meta.duration_sec != null) fd.set("duration_sec", String(meta.duration_sec));

  const resp = await fetch("/api/plaything/upload", {
    method: "POST",
    body: fd,
    credentials: "same-origin",
  });
  const data = (await resp.json().catch(() => ({}))) as {
    error?: string;
    url?: string;
    content_type?: string;
    bytes?: number;
    width?: number | null;
    height?: number | null;
    duration_sec?: number | null;
  };
  if (!resp.ok || !data.url) {
    throw new Error(data.error || `上传失败 (${resp.status})`);
  }
  return {
    url: data.url,
    content_type: data.content_type || file.type,
    bytes: data.bytes ?? file.size,
    width: data.width ?? null,
    height: data.height ?? null,
    duration_sec: data.duration_sec ?? null,
  };
}

/**
 * 上传单个待选媒体并写入缓存；命中缓存直接返回，不重复上传。
 * 供「提示词优化」抢先上传参考图使用——真正提交生成时 uploadAllPending
 * 会用同一个 cache 命中这次上传结果，不会传两遍。
 */
export async function uploadPendingMediaCached(opts: {
  item: PendingMedia;
  productId: number;
  field: string;
  fieldKinds: Record<string, { kind: "image" | "video" | "audio"; accept?: string[] }>;
  cache: Map<string, string>;
}): Promise<string> {
  const cached = opts.cache.get(opts.item.id);
  if (cached) return cached;
  const meta = opts.fieldKinds[opts.field];
  const uploaded = await uploadPlaythingFile({
    file: opts.item.file,
    kind: meta?.kind ?? opts.item.kind,
    productId: opts.productId,
    field: opts.field,
    meta: opts.item.meta,
    accept: meta?.accept,
  });
  opts.cache.set(opts.item.id, uploaded.url);
  return uploaded.url;
}

export async function uploadAllPending(opts: {
  productId: number;
  mediaByField: Record<string, PendingMedia[]>;
  fieldKinds: Record<string, { kind: "image" | "video" | "audio"; accept?: string[] }>;
  /**
   * PendingMedia.id → 已上传 URL 的缓存，命中则跳过重复上传。
   * 用于提示词优化先把参考图传过一次的场景，避免真正提交生成时再传一遍
   * （否则会在 OSS 里留下两份一样的文件、多一条 MediaAsset 记录）。
   */
  cache?: Map<string, string>;
}): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const [field, items] of Object.entries(opts.mediaByField)) {
    if (!items.length) {
      out[field] = [];
      continue;
    }
    const meta = opts.fieldKinds[field];
    const urls: string[] = [];
    for (const item of items) {
      const cached = opts.cache?.get(item.id);
      if (cached) {
        urls.push(cached);
        continue;
      }
      const uploaded = await uploadPlaythingFile({
        file: item.file,
        kind: meta?.kind ?? item.kind,
        productId: opts.productId,
        field,
        meta: item.meta,
        accept: meta?.accept,
      });
      opts.cache?.set(item.id, uploaded.url);
      urls.push(uploaded.url);
    }
    out[field] = urls;
  }
  return out;
}
