import "server-only";
import { db } from "./db";
import { env } from "./env";
import { decryptSecret } from "./secret-crypto";

export type HfCredentials = {
  apiToken: string;
  baseUrl: string;
  magicModel: string;
  accountId: number | null;
  source: "db" | "env";
  label: string;
};

/** 优先使用管理端激活的 HF 账户；无激活时回退 .env HF_TOKEN */
export async function getActiveHfCredentials(): Promise<HfCredentials | null> {
  const active = await db.hfAccount.findFirst({ where: { isActive: true } });
  if (active) {
    return {
      apiToken: decryptSecret(active.apiTokenEnc),
      baseUrl: active.baseUrl?.trim() || env.HF_INFERENCE_BASE_URL,
      magicModel: active.magicModel?.trim() || env.HF_MAGIC_MODEL,
      accountId: active.id,
      source: "db",
      label: active.label,
    };
  }
  if (env.HF_TOKEN) {
    return {
      apiToken: env.HF_TOKEN,
      baseUrl: env.HF_INFERENCE_BASE_URL,
      magicModel: env.HF_MAGIC_MODEL,
      accountId: null,
      source: "env",
      label: "env",
    };
  }
  return null;
}

export async function hfConfigured(): Promise<boolean> {
  return Boolean(await getActiveHfCredentials());
}

/** 轻量校验：调一次 chat/completions（1 token） */
export async function testHfToken(
  apiToken: string,
  opts?: { baseUrl?: string; magicModel?: string }
): Promise<void> {
  const baseUrl = opts?.baseUrl?.trim() || env.HF_INFERENCE_BASE_URL;
  const model = opts?.magicModel?.trim() || env.HF_MAGIC_MODEL;
  const resp = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.15,
      max_tokens: 4,
      messages: [{ role: "user", content: "ping" }],
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`HF API ${resp.status}: ${body.slice(0, 200) || resp.statusText}`);
  }
}
