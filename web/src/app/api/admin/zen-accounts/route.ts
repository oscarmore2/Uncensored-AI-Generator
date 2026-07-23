import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { encryptSecret, decryptSecret, maskSecret } from "@/lib/secret-crypto";
import { env } from "@/lib/env";
import { fetchZenBalanceWithKey, syncZenAccountBalance, isZenCloudflareBlockedError } from "@/lib/zen";

function accountOut(
  a: {
    id: number;
    label: string;
    apiKeyEnc: string;
    isActive: boolean;
    lastKnownBalance: number | null;
    lastBalanceSyncedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  },
  stats?: { task_count: number; zen_credits_consumed: number }
) {
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
    task_count: stats?.task_count ?? 0,
    zen_credits_consumed: stats?.zen_credits_consumed ?? 0,
    created_at: a.createdAt,
    updated_at: a.updatedAt,
  };
}

export async function GET() {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const accounts = await db.zenAccount.findMany({
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
  });
  const activeFromDb = accounts.some((a) => a.isActive);

  const withStats = await Promise.all(
    accounts.map(async (a) => {
      const [taskCount, consumed] = await Promise.all([
        db.generation.count({ where: { zenAccountId: a.id } }),
        db.generation.aggregate({
          where: { zenAccountId: a.id, status: { in: ["succeeded", "partial"] } },
          _sum: { zenCreditsCost: true },
        }),
      ]);
      return accountOut(a, {
        task_count: taskCount,
        zen_credits_consumed: consumed._sum.zenCreditsCost ?? 0,
      });
    })
  );

  return NextResponse.json({
    accounts: withStats,
    env_fallback: {
      configured: Boolean(env.ZEN_API_KEY),
      api_key_mask: env.ZEN_API_KEY ? maskSecret(env.ZEN_API_KEY) : null,
      in_use: !activeFromDb && Boolean(env.ZEN_API_KEY),
    },
    note: "Zen 官方暂无 webhook，任务进度由服务端轮询写入；可用 GET /balance 同步真实余额。",
  });
}

const createSchema = z.object({
  label: z.string().min(1).max(80),
  api_key: z.string().min(10).max(300),
  activate: z.boolean().optional().default(false),
  sync_balance: z.boolean().optional().default(true),
});

export async function POST(req: Request) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, { status: 400 });
  }
  const data = parsed.data;

  if (!data.api_key.startsWith("zc_")) {
    return NextResponse.json({ error: "API Key 通常以 zc_ 开头（如 zc_live_…）" }, { status: 400 });
  }

  let balance: number | null = null;
  let balanceWarning: string | null = null;
  if (data.sync_balance) {
    try {
      balance = await fetchZenBalanceWithKey(data.api_key);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Cloudflare 拦截时仍允许保存 Key（否则永远加不了账户）；生成同样需要配 Worker 代理
      if (isZenCloudflareBlockedError(err)) {
        balanceWarning = msg;
      } else {
        return NextResponse.json({ error: `无法验证 API Key / 拉取余额: ${msg}` }, { status: 400 });
      }
    }
  }

  const account = await db.$transaction(async (tx) => {
    if (data.activate) {
      await tx.zenAccount.updateMany({ where: { isActive: true }, data: { isActive: false } });
    }
    return tx.zenAccount.create({
      data: {
        label: data.label,
        apiKeyEnc: encryptSecret(data.api_key),
        isActive: data.activate,
        lastKnownBalance: balance,
        lastBalanceSyncedAt: balance !== null ? new Date() : null,
      },
    });
  });

  return NextResponse.json(
    {
      ok: true,
      account: accountOut(account),
      ...(balanceWarning ? { warning: balanceWarning } : {}),
    },
    { status: 201 }
  );
}

/** 批量刷新所有账户余额（管理端按钮） */
export async function PATCH(req: Request) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action !== "sync_all_balances") {
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }

  const accounts = await db.zenAccount.findMany();
  const results: { id: number; label: string; balance?: number; error?: string }[] = [];
  for (const a of accounts) {
    try {
      const balance = await syncZenAccountBalance(a.id);
      results.push({ id: a.id, label: a.label, balance });
    } catch (err) {
      results.push({ id: a.id, label: a.label, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return NextResponse.json({ ok: true, results });
}
