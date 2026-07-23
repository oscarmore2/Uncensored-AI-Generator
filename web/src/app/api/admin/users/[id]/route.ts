import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAdminAction } from "@/lib/admin-audit";

const patchSchema = z
  .object({
    role: z.enum(["user", "moderator", "admin"]).optional(),
    balance_delta: z.number().int().min(-1_000_000).max(1_000_000).optional(),
    disabled: z.boolean().optional(),
    is_vip: z.boolean().optional(),
    vip_expires_at: z.string().datetime().nullable().optional(),
    vip_tier_id: z.number().int().positive().nullable().optional(),
    plaything_access: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "至少提供一个字段");

/** 用户详情：概览 + 最近流水/生成/加密订单 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const userId = Number(id);
  if (!Number.isInteger(userId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      role: true,
      balance: true,
      isVip: true,
      vipExpiresAt: true,
      vipTierId: true,
      playthingAccess: true,
      vipTier: { select: { id: true, code: true, name: true, discountBps: true, playthingAccess: true } },
      disabledAt: true,
      createdAt: true,
      _count: { select: { generations: true } },
    },
  });
  if (!user) return NextResponse.json({ error: "用户不存在" }, { status: 404 });

  const [rechargeAgg, recentTx, recentGens, recentCrypto] = await Promise.all([
    db.transaction.aggregate({
      where: { userId, type: "recharge" },
      _sum: { priceCents: true, amount: true },
    }),
    db.transaction.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        type: true,
        amount: true,
        priceCents: true,
        method: true,
        createdAt: true,
      },
    }),
    db.generation.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 15,
      select: {
        id: true,
        mode: true,
        status: true,
        cost: true,
        createdAt: true,
      },
    }),
    db.cryptoPayment.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        orderId: true,
        credits: true,
        amountUsdCents: true,
        status: true,
        credited: true,
        createdAt: true,
      },
    }),
  ]);

  return NextResponse.json({
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      balance: user.balance,
      is_vip: user.isVip,
      vip_expires_at: user.vipExpiresAt,
      plaything_access: user.playthingAccess,
      vip_tier: user.vipTier
        ? {
            id: user.vipTier.id,
            code: user.vipTier.code,
            name: user.vipTier.name,
            discount_bps: user.vipTier.discountBps,
            plaything_access: user.vipTier.playthingAccess,
          }
        : null,
      disabled_at: user.disabledAt,
      created_at: user.createdAt,
      generation_count: user._count.generations,
      total_recharge_cents: rechargeAgg._sum.priceCents ?? 0,
      total_recharge_credits: rechargeAgg._sum.amount ?? 0,
    },
    recent_transactions: recentTx.map((t) => ({
      id: t.id,
      type: t.type,
      amount: t.amount,
      price_cents: t.priceCents,
      method: t.method,
      created_at: t.createdAt,
    })),
    recent_generations: recentGens.map((g) => ({
      id: g.id,
      mode: g.mode,
      status: g.status,
      cost: g.cost,
      created_at: g.createdAt,
    })),
    recent_crypto_payments: recentCrypto.map((p) => ({
      id: p.id,
      order_id: p.orderId,
      credits: p.credits,
      amount_usd_cents: p.amountUsdCents,
      status: p.status,
      credited: p.credited,
      created_at: p.createdAt,
    })),
  });
}

/** 用户管理操作：改角色 / 调整余额 / 封禁解封 / VIP */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const userId = Number(id);
  if (!Number.isInteger(userId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, { status: 400 });
  }
  const data = parsed.data;

  const target = await db.user.findUnique({ where: { id: userId } });
  if (!target) return NextResponse.json({ error: "用户不存在" }, { status: 404 });

  if (userId === admin.id && (data.disabled === true || (data.role && data.role !== "admin"))) {
    return NextResponse.json({ error: "不能封禁或降级自己的账号" }, { status: 400 });
  }

  if (data.balance_delta !== undefined && data.balance_delta !== 0) {
    if (target.balance + data.balance_delta < 0) {
      return NextResponse.json({ error: "调整后余额不能为负" }, { status: 400 });
    }
    await db.$transaction([
      db.user.update({ where: { id: userId }, data: { balance: { increment: data.balance_delta } } }),
      db.transaction.create({
        data: { userId, type: "admin_adjust", amount: data.balance_delta, method: `by:${admin.username}` },
      }),
    ]);
    await logAdminAction(admin.id, "user_balance", { type: "user", id: userId }, {
      delta: data.balance_delta,
    });
  }

  const vipData: {
    isVip?: boolean;
    vipExpiresAt?: Date | null;
    vipTierId?: number | null;
  } = {};
  if (data.is_vip !== undefined) {
    vipData.isVip = data.is_vip;
    if (!data.is_vip) {
      vipData.vipExpiresAt = null;
      vipData.vipTierId = null;
    }
  }
  if (data.vip_expires_at !== undefined) {
    vipData.vipExpiresAt = data.vip_expires_at ? new Date(data.vip_expires_at) : null;
    if (data.vip_expires_at) vipData.isVip = true;
  }
  if (data.vip_tier_id !== undefined) {
    vipData.vipTierId = data.vip_tier_id;
    if (data.vip_tier_id) vipData.isVip = true;
  }
  if (data.is_vip === true && data.vip_expires_at === undefined && !target.vipExpiresAt) {
    vipData.vipExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  }
  if (data.is_vip === true && data.vip_tier_id === undefined && !target.vipTierId) {
    const defaultTier = await db.vipTier.findFirst({
      where: { isActive: true },
      orderBy: [{ rank: "asc" }, { id: "asc" }],
    });
    if (defaultTier) vipData.vipTierId = defaultTier.id;
  }

  const grantingVip = data.is_vip === true && !target.isVip;
  if (grantingVip) {
    await db.transaction.create({
      data: { userId, type: "vip", amount: 0, method: "admin" },
    });
  }

  if (Object.keys(vipData).length > 0) {
    await logAdminAction(admin.id, "user_vip", { type: "user", id: userId }, {
      is_vip: vipData.isVip ?? target.isVip,
      vip_expires_at: vipData.vipExpiresAt?.toISOString() ?? null,
    });
  }

  if (data.role && data.role !== target.role) {
    await logAdminAction(admin.id, "user_role", { type: "user", id: userId }, {
      from: target.role,
      to: data.role,
    });
  }

  if (data.disabled !== undefined) {
    await logAdminAction(admin.id, "user_disable", { type: "user", id: userId }, {
      disabled: data.disabled,
    });
  }

  if (data.plaything_access !== undefined && data.plaything_access !== target.playthingAccess) {
    await logAdminAction(admin.id, "user_plaything", { type: "user", id: userId }, {
      plaything_access: data.plaything_access,
    });
  }

  const updated = await db.user.update({
    where: { id: userId },
    data: {
      ...(data.role ? { role: data.role } : {}),
      ...(data.disabled !== undefined ? { disabledAt: data.disabled ? new Date() : null } : {}),
      ...(data.plaything_access !== undefined ? { playthingAccess: data.plaything_access } : {}),
      ...vipData,
    },
  });

  return NextResponse.json({
    ok: true,
    user: {
      id: updated.id,
      username: updated.username,
      role: updated.role,
      balance: updated.balance,
      is_vip: updated.isVip,
      vip_expires_at: updated.vipExpiresAt,
      vip_tier_id: updated.vipTierId,
      plaything_access: updated.playthingAccess,
      disabled_at: updated.disabledAt,
    },
  });
}
