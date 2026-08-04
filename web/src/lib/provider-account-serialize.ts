import "server-only";
import { decryptSecret, maskSecret } from "./secret-crypto";
import { toProviderId } from "./providers/meta";

/**
 * 渠道账户的对外形状。
 * 单独放一个模块而不是从 route.ts 导出：Next.js 的 Route Handler
 * 只允许导出 HTTP 方法，多导一个函数会直接编译失败。
 */
export function providerAccountOut(a: {
  id: number;
  provider: string;
  label: string;
  apiKeyEnc: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  let keyMask = "****";
  try {
    keyMask = maskSecret(decryptSecret(a.apiKeyEnc));
  } catch {
    keyMask = "(解密失败)";
  }
  return {
    id: a.id,
    provider: toProviderId(a.provider),
    label: a.label,
    api_key_mask: keyMask,
    is_active: a.isActive,
    created_at: a.createdAt,
    updated_at: a.updatedAt,
  };
}
