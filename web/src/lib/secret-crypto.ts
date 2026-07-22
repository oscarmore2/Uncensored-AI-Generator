import "server-only";
import crypto from "crypto";
import { env } from "./env";

/** 用 AUTH_SECRET 派生 AES-256 密钥，加密敏感配置（如 Cryptomus API Key） */
function deriveKey(): Buffer {
  return crypto.createHash("sha256").update(env.AUTH_SECRET).digest();
}

/** 返回 base64(iv[12] + tag[16] + ciphertext) */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptSecret(encoded: string): string {
  const buf = Buffer.from(encoded, "base64");
  if (buf.length < 28) throw new Error("Invalid encrypted secret");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/** 列表展示用掩码：保留末 4 位 */
export function maskSecret(plain: string): string {
  if (plain.length <= 4) return "****";
  return `${"*".repeat(Math.min(20, plain.length - 4))}${plain.slice(-4)}`;
}
