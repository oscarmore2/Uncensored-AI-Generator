import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { encryptSecret, decryptSecret, maskSecret } from "@/lib/secret-crypto";
import { env } from "@/lib/env";
import { testWaveSpeedKey } from "@/lib/wavespeed";

function accountOut(a: {
  id: number;
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
    label: a.label,
    api_key_mask: keyMask,
    is_active: a.isActive,
    created_at: a.createdAt,
    updated_at: a.updatedAt,
  };
}

export async function GET() {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const accounts = await db.waveSpeedAccount.findMany({
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
  });
  const activeFromDb = accounts.some((a) => a.isActive);

  return NextResponse.json({
    accounts: accounts.map(accountOut),
    defaults: { base_url: env.WAVESPEED_BASE_URL },
    env_fallback: {
      configured: Boolean(env.WAVESPEED_API_KEY),
      api_key_mask: env.WAVESPEED_API_KEY ? maskSecret(env.WAVESPEED_API_KEY) : null,
      in_use: !activeFromDb && Boolean(env.WAVESPEED_API_KEY),
    },
    note: "玩物专区使用 WaveSpeed.ai。同一时间仅一个 Key 激活；无 DB 账户时回退 WAVESPEED_API_KEY。",
  });
}

const createSchema = z.object({
  label: z.string().min(1).max(80),
  api_key: z.string().min(8).max(500),
  activate: z.boolean().optional().default(false),
  verify: z.boolean().optional().default(true),
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

  let verifyWarning: string | null = null;
  if (data.verify) {
    try {
      await testWaveSpeedKey(data.api_key);
    } catch (err) {
      verifyWarning = err instanceof Error ? err.message : String(err);
    }
  }

  const account = await db.$transaction(async (tx) => {
    if (data.activate) {
      await tx.waveSpeedAccount.updateMany({ where: { isActive: true }, data: { isActive: false } });
    }
    return tx.waveSpeedAccount.create({
      data: {
        label: data.label,
        apiKeyEnc: encryptSecret(data.api_key),
        isActive: data.activate,
      },
    });
  });

  return NextResponse.json(
    {
      ok: true,
      account: accountOut(account),
      ...(verifyWarning ? { warning: verifyWarning } : {}),
    },
    { status: 201 }
  );
}
