import "server-only";
import crypto from "crypto";

/** 常量时间比较两个字符串（长度不同时立即返回 false） */
export function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** 仅允许站内相对路径，防止 //evil.com 一类 open redirect */
export function safeInternalPath(raw: string | null | undefined, fallback = "/make"): string {
  if (!raw) return fallback;
  const path = raw.trim();
  // 必须以单个 / 开头，且不能是 // 或 /\，不能含协议
  if (!/^\/(?!\/)/.test(path)) return fallback;
  if (path.includes("://") || path.includes("\\")) return fallback;
  if (path.length > 512) return fallback;
  return path;
}
