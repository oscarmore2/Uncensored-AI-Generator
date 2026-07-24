import "server-only";
import { imageSize } from "image-size";
import type { MediaFieldPolicy } from "./plaything-param-policy";

const MAGIC: Array<{ mime: string; test: (b: Buffer) => boolean }> = [
  { mime: "image/jpeg", test: (b) => b.length > 2 && b[0] === 0xff && b[1] === 0xd8 },
  {
    mime: "image/png",
    test: (b) =>
      b.length > 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47,
  },
  {
    mime: "image/webp",
    test: (b) =>
      b.length > 12 &&
      b.toString("ascii", 0, 4) === "RIFF" &&
      b.toString("ascii", 8, 12) === "WEBP",
  },
  {
    mime: "image/gif",
    test: (b) => b.length > 6 && (b.toString("ascii", 0, 6) === "GIF87a" || b.toString("ascii", 0, 6) === "GIF89a"),
  },
  {
    mime: "video/mp4",
    test: (b) => b.length > 12 && b.toString("ascii", 4, 8) === "ftyp",
  },
  {
    mime: "video/webm",
    test: (b) => b.length > 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3,
  },
  {
    mime: "audio/mpeg",
    test: (b) =>
      (b.length > 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0) ||
      (b.length > 3 && b.toString("ascii", 0, 3) === "ID3"),
  },
  {
    mime: "audio/wav",
    test: (b) =>
      b.length > 12 &&
      b.toString("ascii", 0, 4) === "RIFF" &&
      b.toString("ascii", 8, 12) === "WAVE",
  },
  {
    mime: "audio/ogg",
    test: (b) => b.length > 4 && b.toString("ascii", 0, 4) === "OggS",
  },
];

export function sniffMime(buf: Buffer): string | null {
  for (const m of MAGIC) {
    if (m.test(buf)) return m.mime;
  }
  return null;
}

/** 将浏览器声明 MIME 归一到白名单可比对形式 */
export function normalizeMime(mime: string): string {
  const m = mime.toLowerCase().split(";")[0].trim();
  if (m === "audio/x-wav" || m === "audio/wave") return "audio/wav";
  if (m === "image/jpg") return "image/jpeg";
  if (m === "video/quicktime") return "video/quicktime";
  return m;
}

export type MediaMetaInput = {
  width?: number;
  height?: number;
  duration_sec?: number;
};

export type ValidatedMedia = {
  contentType: string;
  bytes: number;
  width?: number;
  height?: number;
  duration_sec?: number;
};

export function validateUploadedMedia(opts: {
  buffer: Buffer;
  declaredMime: string;
  kind: "image" | "video" | "audio";
  policy: MediaFieldPolicy;
  meta?: MediaMetaInput;
}): ValidatedMedia {
  const { buffer, kind, policy, meta } = opts;
  const maxBytes = policy.maxBytes ?? (kind === "video" ? 100 * 1024 * 1024 : 15 * 1024 * 1024);
  if (buffer.length <= 0) throw new Error("空文件");
  if (buffer.length > maxBytes) {
    throw new Error(`文件过大（上限 ${Math.round(maxBytes / 1024 / 1024)}MB）`);
  }

  const sniffed = sniffMime(buffer);
  const declared = normalizeMime(opts.declaredMime || "");
  const accept = (policy.accept ?? []).map(normalizeMime);
  const contentType = sniffed || declared;
  if (!contentType) throw new Error("无法识别文件类型");

  if (accept.length && !accept.includes(contentType) && !accept.includes(declared)) {
    // quicktime 常被 sniff 成 mp4 ftyp
    if (!(contentType === "video/mp4" && accept.includes("video/quicktime"))) {
      throw new Error(`不支持的 MIME：${contentType}（允许：${accept.join(", ")}）`);
    }
  }

  if (kind === "image" && !contentType.startsWith("image/")) {
    throw new Error("期望图片文件");
  }
  if (kind === "video" && !contentType.startsWith("video/") && contentType !== "video/mp4") {
    throw new Error("期望视频文件");
  }
  if (kind === "audio" && !contentType.startsWith("audio/")) {
    throw new Error("期望音频文件");
  }

  let width = meta?.width;
  let height = meta?.height;
  const duration_sec = meta?.duration_sec;

  if (kind === "image") {
    try {
      const dim = imageSize(buffer);
      if (dim.width) width = dim.width;
      if (dim.height) height = dim.height;
    } catch {
      throw new Error("无法读取图片尺寸");
    }
  }

  if (width != null && height != null) {
    if (policy.minWidth && width < policy.minWidth) {
      throw new Error(`宽度过小（最小 ${policy.minWidth}px）`);
    }
    if (policy.minHeight && height < policy.minHeight) {
      throw new Error(`高度过小（最小 ${policy.minHeight}px）`);
    }
    if (policy.maxWidth && width > policy.maxWidth) {
      throw new Error(`宽度过大（最大 ${policy.maxWidth}px）`);
    }
    if (policy.maxHeight && height > policy.maxHeight) {
      throw new Error(`高度过大（最大 ${policy.maxHeight}px）`);
    }
  } else if (kind === "image") {
    throw new Error("缺少图片尺寸信息");
  }

  if (kind === "video") {
    if (duration_sec == null || !Number.isFinite(duration_sec) || duration_sec <= 0) {
      throw new Error("缺少视频时长信息，请使用支持的浏览器重新选择文件");
    }
    const maxDur = policy.maxDurationSec ?? 30;
    if (duration_sec > maxDur + 0.25) {
      throw new Error(`视频过长（最长 ${maxDur} 秒）`);
    }
    if (width == null || height == null) {
      throw new Error("缺少视频分辨率信息");
    }
  }

  return {
    contentType,
    bytes: buffer.length,
    width,
    height,
    duration_sec,
  };
}

export function extForMime(mime: string): string {
  const m = normalizeMime(mime);
  switch (m) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "video/mp4":
      return "mp4";
    case "video/webm":
      return "webm";
    case "video/quicktime":
      return "mov";
    case "audio/mpeg":
      return "mp3";
    case "audio/wav":
      return "wav";
    case "audio/ogg":
      return "ogg";
    case "audio/mp4":
      return "m4a";
    default:
      return "bin";
  }
}
