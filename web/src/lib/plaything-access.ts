import "server-only";
import { isVipActive } from "./pricing";

/**
 * 玩物专区门禁：
 * - admin / moderator 始终可进
 * - User.playthingAccess 单独授权
 * - 或 VIP 有效且等级开启 VipTier.playthingAccess
 */
export function hasPlaythingAccess(
  user: {
    role: string;
    playthingAccess: boolean;
    isVip: boolean;
    vipExpiresAt: Date | null;
    vipTier?: { isActive: boolean; playthingAccess: boolean } | null;
  } | null | undefined
): boolean {
  if (!user) return false;
  if (user.role === "admin" || user.role === "moderator") return true;
  if (user.playthingAccess) return true;
  if (!isVipActive(user)) return false;
  return Boolean(user.vipTier?.isActive && user.vipTier.playthingAccess);
}
