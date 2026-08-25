import "server-only";
import { isVipActive } from "../pricing";

/**
 * 能不能自建 / fork / 导入技能。
 *
 * 与「能用多贵的模型」**刻意分开**（规划第五节）：`VipTier.rank` 管后者，
 * 这一位管前者。合成一个的话，管理员想单独关停一个滥用技能编辑的用户，
 * 就只能降他的 VIP——那是在惩罚他付过的钱。
 *
 * 判定沿用 `plaything-access.ts` 的写法：单独授权 或 VIP 有效且该等级开启。
 */
export function hasSkillAuthoring(
  user:
    | {
        role: string;
        skillAuthoring: boolean;
        isVip: boolean;
        vipExpiresAt: Date | null;
        vipTier?: { isActive: boolean; skillAuthoring: boolean } | null;
      }
    | null
    | undefined
): boolean {
  if (!user) return false;
  if (user.role === "admin" || user.role === "moderator") return true;
  if (user.skillAuthoring) return true;
  if (!isVipActive(user)) return false;
  return Boolean(user.vipTier?.isActive && user.vipTier.skillAuthoring);
}

/**
 * 每人最多能有多少条技能。
 *
 * 规划里没提，但不设上限是一个明摆着的洞：技能是一行带两段长文本的记录，
 * 脚本刷几万条就能把库撑起来。50 条对真实用法绰绰有余——官方总共才六条。
 */
export const MAX_USER_SKILLS = 50;
