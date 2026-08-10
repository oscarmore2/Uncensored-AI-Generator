import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listActiveCatalog, isVipActive } from "@/lib/pricing";

/** 登录用户可见的价目/产品目录（不含密钥） */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const vipActive = isVipActive(user);
  const catalog = await listActiveCatalog({ vipActive });

  return NextResponse.json({
    ...catalog,
    user_vip: {
      is_active: vipActive,
      tier: user.vipTier
        ? {
            id: user.vipTier.id,
            code: user.vipTier.code,
            name: user.vipTier.name,
            // 生成端要拿它跟档位的 min_vip_rank 比，判断终极档能不能点
            rank: user.vipTier.rank,
            discount_bps: user.vipTier.discountBps,
            discount_percent: user.vipTier.discountBps / 100,
          }
        : null,
      expires_at: user.vipExpiresAt,
    },
  });
}
