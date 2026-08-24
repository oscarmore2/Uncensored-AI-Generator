import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { encryptSecret, maskSecret } from "@/lib/secret-crypto";
import { env } from "@/lib/env";
import { logAdminAction } from "@/lib/admin-audit";
import { testLlmKey } from "@/lib/llm/account";
import { hfConfigured } from "@/lib/hf";
import { llmAccountOut } from "@/lib/llm/account-serialize";

export async function GET() {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const accounts = await db.llmAccount.findMany({
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
  });
  const activeFromDb = accounts.some((a) => a.isActive);
  const envConfigured = Boolean(env.OPENROUTER_API_KEY);

  return NextResponse.json({
    accounts: accounts.map(llmAccountOut),
    defaults: { base_url: env.OPENROUTER_BASE_URL },
    env_fallback: {
      configured: envConfigured,
      api_key_mask: envConfigured ? maskSecret(env.OPENROUTER_API_KEY) : null,
      in_use: !activeFromDb && envConfigured,
    },
    /*
     * 三级兜底要在界面上说清楚，否则「我明明配了为什么没生效」会变成
     * 一个反复出现的问题。
     */
    hf_fallback: {
      configured: await hfConfigured(),
      in_use: !activeFromDb && !envConfigured,
    },
  });
}

const createSchema = z.object({
  label: z.string().min(1).max(80),
  api_key: z.string().min(10).max(500),
  base_url: z.string().url().max(300).nullable().optional(),
  activate: z.boolean().optional().default(true),
  verify: z.boolean().optional().default(true),
});

export async function POST(req: Request) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, { status: 400 });
  }
  const data = parsed.data;
  const baseUrl = data.base_url?.trim() || null;

  let verifyWarning: string | null = null;
  if (data.verify) {
    try {
      await testLlmKey(data.api_key, baseUrl ?? undefined);
    } catch (err) {
      // 允许保存但提示：上游偶发故障时不该把人卡在配置页
      verifyWarning = err instanceof Error ? err.message : String(err);
    }
  }

  const account = await db.$transaction(async (tx) => {
    if (data.activate) {
      await tx.llmAccount.updateMany({ where: { isActive: true }, data: { isActive: false } });
    }
    return tx.llmAccount.create({
      data: {
        provider: "openrouter",
        label: data.label,
        apiKeyEnc: encryptSecret(data.api_key),
        baseUrl,
        isActive: data.activate,
      },
    });
  });

  await logAdminAction(admin.id, "llm_account", { type: "llm_account", id: account.id }, {
    op: "create",
    label: account.label,
    activate: data.activate,
  });

  return NextResponse.json(
    { ok: true, account: llmAccountOut(account), ...(verifyWarning ? { warning: verifyWarning } : {}) },
    { status: 201 }
  );
}
