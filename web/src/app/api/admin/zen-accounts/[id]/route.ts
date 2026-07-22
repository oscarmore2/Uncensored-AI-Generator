import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { encryptSecret, decryptSecret, maskSecret } from "@/lib/secret-crypto";
import { fetchZenBalanceWithKey, syncZenAccountBalance } from "@/lib/zen";

function accountOut(a: {
  id: number;
  label: string;
  apiKeyEnc: string;
  isActive: boolean;
  lastKnownBalance: number | null;
  lastBalanceSyncedAt: Date | null;
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
    label: a.label,
    api_key_mask: keyMask,
    is_active: a.isActive,
    last_known_balance: a.lastKnownBalance,
    last_balance_synced_at: a.lastBalanceSyncedAt,
    created_at: a.createdAt,
    updated_at: a.updatedAt,
  };
}

const patchSchema = z
  .object({
    label: z.string().min(1).max(80).optional(),
    api_key: z.string().min(10).max(300).optional(),
    activate: z.boolean().optional(),
    sync_balance: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "至少提供一个字段");

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const accountId = Number(id);
  if (!Number.isInteger(accountId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, { status: 400 });
  }
  const data = parsed.data;

  const existing = await db.zenAccount.findUnique({ where: { id: accountId } });
  if (!existing) return NextResponse.json({ error: "账户不存在" }, { status: 404 });

  if (data.api_key && !data.api_key.startsWith("zc_")) {
    return NextResponse.json({ error: "API Key 通常以 zc_ 开头" }, { status: 400 });
  }

  if (data.api_key) {
    try {
      await fetchZenBalanceWithKey(data.api_key);
    } catch (err) {
      return NextResponse.json(
        { error: `无法验证 API Key: ${err instanceof Error ? err.message : err}` },
        { status: 400 }
      );
    }
  }

  const account = await db.$transaction(async (tx) => {
    if (data.activate === true) {
      await tx.zenAccount.updateMany({ where: { isActive: true }, data: { isActive: false } });
    }
    return tx.zenAccount.update({
      where: { id: accountId },
      data: {
        ...(data.label !== undefined ? { label: data.label } : {}),
        ...(data.api_key !== undefined ? { apiKeyEnc: encryptSecret(data.api_key) } : {}),
        ...(data.activate === true ? { isActive: true } : {}),
        ...(data.activate === false ? { isActive: false } : {}),
      },
    });
  });

  if (data.sync_balance || data.api_key) {
    try {
      await syncZenAccountBalance(accountId);
    } catch (err) {
      console.warn("[zen] sync after patch failed:", err);
    }
  }

  const fresh = await db.zenAccount.findUniqueOrThrow({ where: { id: accountId } });
  return NextResponse.json({ ok: true, account: accountOut(fresh) });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const accountId = Number(id);
  if (!Number.isInteger(accountId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const existing = await db.zenAccount.findUnique({ where: { id: accountId } });
  if (!existing) return NextResponse.json({ error: "账户不存在" }, { status: 404 });

  await db.zenAccount.delete({ where: { id: accountId } });
  return NextResponse.json({ ok: true });
}

/** 该账户下的任务列表（本地 Generation ↔ zenJobId） */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const accountId = Number(id);
  if (!Number.isInteger(accountId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 30));

  const where = { zenAccountId: accountId };
  const [total, gens] = await Promise.all([
    db.generation.count({ where }),
    db.generation.findMany({
      where,
      include: { user: { select: { username: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return NextResponse.json({
    total,
    page,
    limit,
    tasks: gens.map((g) => ({
      id: g.id,
      zen_job_id: g.zenJobId,
      user_id: g.userId,
      username: g.user.username,
      mode: g.mode,
      status: g.status,
      progress: g.progress,
      cost: g.cost,
      zen_credits_cost: g.zenCreditsCost,
      prompt: g.prompt.slice(0, 120),
      created_at: g.createdAt,
    })),
  });
}
