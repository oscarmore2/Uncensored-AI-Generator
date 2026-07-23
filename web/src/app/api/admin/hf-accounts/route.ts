import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { encryptSecret, decryptSecret, maskSecret } from "@/lib/secret-crypto";
import { env } from "@/lib/env";
import { testHfToken } from "@/lib/hf";

function accountOut(a: {
  id: number;
  label: string;
  apiTokenEnc: string;
  baseUrl: string | null;
  magicModel: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  let tokenMask = "****";
  try {
    tokenMask = maskSecret(decryptSecret(a.apiTokenEnc));
  } catch {
    tokenMask = "(解密失败)";
  }
  return {
    id: a.id,
    label: a.label,
    api_token_mask: tokenMask,
    base_url: a.baseUrl,
    magic_model: a.magicModel,
    is_active: a.isActive,
    created_at: a.createdAt,
    updated_at: a.updatedAt,
  };
}

export async function GET() {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const accounts = await db.hfAccount.findMany({
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
  });
  const activeFromDb = accounts.some((a) => a.isActive);

  return NextResponse.json({
    accounts: accounts.map((a) => accountOut(a)),
    defaults: {
      base_url: env.HF_INFERENCE_BASE_URL,
      magic_model: env.HF_MAGIC_MODEL,
    },
    env_fallback: {
      configured: Boolean(env.HF_TOKEN),
      api_token_mask: env.HF_TOKEN ? maskSecret(env.HF_TOKEN) : null,
      in_use: !activeFromDb && Boolean(env.HF_TOKEN),
    },
    note: "魔法指令使用 Dolphin-Mistral-24B-Venice（HF Inference Providers）。未配置 Token 时创作页不显示魔法指令按钮。",
  });
}

const createSchema = z.object({
  label: z.string().min(1).max(80),
  api_token: z.string().min(10).max(500),
  base_url: z.string().url().max(300).nullable().optional(),
  magic_model: z.string().min(1).max(200).nullable().optional(),
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

  if (!data.api_token.startsWith("hf_")) {
    return NextResponse.json(
      { error: "Token 通常以 hf_ 开头（https://huggingface.co/settings/tokens）" },
      { status: 400 }
    );
  }

  const baseUrl = data.base_url?.trim() || null;
  const magicModel = data.magic_model?.trim() || null;

  let verifyWarning: string | null = null;
  if (data.verify) {
    try {
      await testHfToken(data.api_token, {
        baseUrl: baseUrl ?? undefined,
        magicModel: magicModel ?? undefined,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // 允许保存但提示：额度/provider 偶发失败时仍可配置
      verifyWarning = msg;
    }
  }

  const account = await db.$transaction(async (tx) => {
    if (data.activate) {
      await tx.hfAccount.updateMany({ where: { isActive: true }, data: { isActive: false } });
    }
    return tx.hfAccount.create({
      data: {
        label: data.label,
        apiTokenEnc: encryptSecret(data.api_token),
        baseUrl,
        magicModel,
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
