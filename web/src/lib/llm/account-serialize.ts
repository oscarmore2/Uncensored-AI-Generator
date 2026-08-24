import "server-only";
import { decryptSecret, maskSecret } from "../secret-crypto";

/**
 * 账户行 → 管理端 JSON。**永远只回掩码**，明文密钥一次都不下发。
 *
 * 放在 lib 而不是路由里：Next 的 route 文件只允许导出 HTTP handler，
 * 从一个路由 import 另一个路由的辅助函数会直接构建失败。
 */
export type LlmAccountRow = {
  id: number;
  provider: string;
  label: string;
  apiKeyEnc: string;
  baseUrl: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export function llmAccountOut(a: LlmAccountRow) {
  let mask = "****";
  try {
    mask = maskSecret(decryptSecret(a.apiKeyEnc));
  } catch {
    mask = "(解密失败)";
  }
  return {
    id: a.id,
    provider: a.provider,
    label: a.label,
    api_key_mask: mask,
    base_url: a.baseUrl,
    is_active: a.isActive,
    created_at: a.createdAt,
    updated_at: a.updatedAt,
  };
}
