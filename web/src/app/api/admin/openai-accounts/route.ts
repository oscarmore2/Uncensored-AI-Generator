import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { encryptSecret, decryptSecret, maskSecret } from "@/lib/secret-crypto";
import { env } from "@/lib/env";
import { testOpenAiKey } from "@/lib/openai";

function accountOut(a: {
  id: number;
  label: string;
  apiKeyEnc: string;
  baseUrl: string | null;
  moderationModel: string | null;
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
    base_url: a.baseUrl,
    moderation_model: a.moderationModel,
    is_active: a.isActive,
    created_at: a.createdAt,
    updated_at: a.updatedAt,
  };
}

export async function GET() {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const accounts = await db.openAiAccount.findMany({
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
  });
  const activeFromDb = accounts.some((a) => a.isActive);

  return NextResponse.json({
    accounts: accounts.map((a) => accountOut(a)),
    defaults: {
      base_url: env.OPENAI_BASE_URL,
      moderation_model: env.OPENAI_MODERATION_MODEL,
    },
    env_fallback: {
      configured: Boolean(env.OPENAI_API_KEY),
      api_key_mask: env.OPENAI_API_KEY ? maskSecret(env.OPENAI_API_KEY) : null,
      in_use: !activeFromDb && Boolean(env.OPENAI_API_KEY),
    },
    note:
      "内容审查链路：本地正则 → OpenAI Moderation → HF LLM。" +
      "moderations 端点免费，同时用于提示词与图像审查；未配置时自动降级到 HF，" +
      "两者都不可用则以本地正则结论为准并标记 degraded。",
  });
}

const createSchema = z.object({
  label: z.string().min(1).max(80),
  api_key: z.string().min(10).max(500),
  base_url: z.string().url().max(300).nullable().optional(),
  moderation_model: z.string().min(1).max(200).nullable().optional(),
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

  const baseUrl = data.base_url?.trim() || null;
  const moderationModel = data.moderation_model?.trim() || null;

  // 官方 Key 以 sk- 开头；兼容代理可能用别的前缀，因此只提示不拦截
  let verifyWarning: string | null = null;
  if (data.verify) {
    try {
      await testOpenAiKey(data.api_key, {
        baseUrl: baseUrl ?? undefined,
        moderationModel: moderationModel ?? undefined,
      });
    } catch (err) {
      verifyWarning = err instanceof Error ? err.message : String(err);
    }
  }

  const account = await db.$transaction(async (tx) => {
    if (data.activate) {
      await tx.openAiAccount.updateMany({ where: { isActive: true }, data: { isActive: false } });
    }
    return tx.openAiAccount.create({
      data: {
        label: data.label,
        apiKeyEnc: encryptSecret(data.api_key),
        baseUrl,
        moderationModel,
        isActive: data.activate,
      },
    });
  });

  return NextResponse.json(
    { ok: true, account: accountOut(account), ...(verifyWarning ? { warning: verifyWarning } : {}) },
    { status: 201 }
  );
}
