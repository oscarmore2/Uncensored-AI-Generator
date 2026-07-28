import "server-only";
import {
  getActiveWaveSpeedCredentials,
  submitWaveSpeedTask,
  wavespeedFetch,
  mapWaveSpeedStatus,
} from "./wavespeed";

/**
 * 玩物专区专属：WaveSpeed 官方的 wavespeed-ai/prompt-optimizer 模型。
 * 与站内其它 WaveSpeed 模型共用同一套账户/轮询机制，但输出是纯文本而非媒体 URL，
 * 所以不能复用 pollWaveSpeedResult（它只保留 http 开头的字符串，会把文本结果过滤掉）。
 *
 * 与创作中心的「魔法指令」（HF LLM 扩写）是两条独立链路，互不替代：
 * 这个走 WaveSpeed 账户，支持把参考图一起送进去优化，按你的要求只在玩物专区提供。
 */

const PROMPT_OPTIMIZER_MODEL_ID = "wavespeed-ai/prompt-optimizer";

export type PromptOptimizeMode = "image" | "video";
export type PromptOptimizeStyle =
  | "default"
  | "artistic"
  | "photographic"
  | "technical"
  | "anime"
  | "realistic";

export async function promptOptimizerConfigured(): Promise<boolean> {
  return Boolean(await getActiveWaveSpeedCredentials());
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function extractText(raw: unknown): string | null {
  if (typeof raw === "string") {
    const t = raw.trim();
    return t || null;
  }
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string" && item.trim()) return item.trim();
      if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        const t = o.text ?? o.prompt ?? o.output;
        if (typeof t === "string" && t.trim()) return t.trim();
      }
    }
  }
  return null;
}

export async function optimizePrompt(opts: {
  text: string;
  imageUrl?: string | null;
  mode: PromptOptimizeMode;
  style?: PromptOptimizeStyle;
}): Promise<string> {
  const creds = await getActiveWaveSpeedCredentials();
  if (!creds) throw new Error("WaveSpeed 未配置，暂时无法使用提示词优化");

  const inputs: Record<string, unknown> = {
    text: opts.text,
    mode: opts.mode,
    style: opts.style ?? "default",
  };
  if (opts.imageUrl) inputs.image = opts.imageUrl;

  const task = await submitWaveSpeedTask(creds.apiKey, PROMPT_OPTIMIZER_MODEL_ID, inputs);

  let status = mapWaveSpeedStatus(task.status);
  let text: string | null = null;

  for (let i = 0; i < 20 && status !== "succeeded" && status !== "failed"; i++) {
    await sleep(i < 5 ? 800 : 1500);
    const data = await wavespeedFetch<{
      status?: string;
      outputs?: unknown;
      output?: unknown;
      error?: string;
      data?: { status?: string; outputs?: unknown; output?: unknown; error?: string };
    }>(creds.apiKey, `/predictions/${encodeURIComponent(task.id)}/result`);

    status = mapWaveSpeedStatus(String(data?.status || data?.data?.status || "processing"));
    if (status === "failed") {
      const err = data?.error || data?.data?.error;
      throw new Error(err ? String(err).slice(0, 300) : "提示词优化失败");
    }
    text = extractText(data?.outputs ?? data?.output ?? data?.data?.outputs ?? data?.data?.output);
  }

  if (!text) throw new Error("提示词优化超时或未返回结果，请稍后再试");
  return text;
}
