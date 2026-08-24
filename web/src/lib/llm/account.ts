import "server-only";
import { env } from "../env";

/**
 * 轻量校验上游 Key。
 *
 * 打 `/key` 而不是随便发一次对话：那个端点只回额度与限速信息，**不烧 token**。
 * 管理员试填一个 key 就扣一次钱是很荒唐的事。
 */
export async function testLlmKey(apiKey: string, baseUrl?: string): Promise<void> {
  const base = (baseUrl?.trim() || env.OPENROUTER_BASE_URL).replace(/\/$/, "");
  const resp = await fetch(`${base}/key`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`LLM API ${resp.status}: ${body.slice(0, 200) || resp.statusText}`);
  }
}
