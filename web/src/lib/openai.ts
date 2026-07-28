import "server-only";
import { db } from "./db";
import { env } from "./env";
import { decryptSecret } from "./secret-crypto";

export type OpenAiCredentials = {
  apiKey: string;
  baseUrl: string;
  moderationModel: string;
  accountId: number | null;
  source: "db" | "env";
  label: string;
};

/** 优先使用管理端激活的 OpenAI 账户；无激活时回退 .env OPENAI_API_KEY */
export async function getActiveOpenAiCredentials(): Promise<OpenAiCredentials | null> {
  const active = await db.openAiAccount.findFirst({ where: { isActive: true } });
  if (active) {
    return {
      apiKey: decryptSecret(active.apiKeyEnc),
      baseUrl: active.baseUrl?.trim() || env.OPENAI_BASE_URL,
      moderationModel: active.moderationModel?.trim() || env.OPENAI_MODERATION_MODEL,
      accountId: active.id,
      source: "db",
      label: active.label,
    };
  }
  if (env.OPENAI_API_KEY) {
    return {
      apiKey: env.OPENAI_API_KEY,
      baseUrl: env.OPENAI_BASE_URL,
      moderationModel: env.OPENAI_MODERATION_MODEL,
      accountId: null,
      source: "env",
      label: "env",
    };
  }
  return null;
}

export async function openAiConfigured(): Promise<boolean> {
  return Boolean(await getActiveOpenAiCredentials());
}

/** 轻量校验：用一段中性文本调一次 moderations（该端点免费） */
export async function testOpenAiKey(
  apiKey: string,
  opts?: { baseUrl?: string; moderationModel?: string }
): Promise<void> {
  const baseUrl = opts?.baseUrl?.trim() || env.OPENAI_BASE_URL;
  const model = opts?.moderationModel?.trim() || env.OPENAI_MODERATION_MODEL;
  const resp = await fetch(`${baseUrl.replace(/\/$/, "")}/moderations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({ model, input: "hello" }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`OpenAI API ${resp.status}: ${body.slice(0, 200) || resp.statusText}`);
  }
  const data = (await resp.json().catch(() => null)) as { results?: unknown[] } | null;
  if (!data?.results?.length) {
    throw new Error("OpenAI moderations 返回异常，请检查 Key 与模型名");
  }
}
