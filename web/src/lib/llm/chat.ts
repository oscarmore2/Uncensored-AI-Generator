import "server-only";
import { db } from "../db";
import { env } from "../env";
import { getActiveHfCredentials } from "../hf";
import { decryptSecret } from "../secret-crypto";
import { estimateCostUsd, type LlmModelSpec } from "./models";
import { createSseParser, type ChatStreamChunk } from "./sse";

/**
 * 文本 LLM 的统一调用层。
 *
 * 上游选定 OpenRouter（规划 10.1），但这一层**不假设**只有它：接口是
 * OpenAI 兼容的 chat-completions，HuggingFace Router 也是同一套。没配
 * OpenRouter 时自动退回站内已有的 HF 凭据，于是选区级 AI 在换上游之前
 * 就能端到端跑起来——不然「先接账户，再验管线」，出了问题分不清是哪一层。
 *
 * 刻意**不复用** `ProviderAccount` / `ProviderAdapter`：那套是任务制
 * （submit → 轮询）、按次计价、还要 fetchSchema，这里一个都用不上。
 * 硬塞进去会让那套抽象长出一堆只有一家用得上的可选方法。
 */

export type LlmProvider = "openrouter" | "hf";

export type LlmCredentials = {
  provider: LlmProvider;
  apiKey: string;
  baseUrl: string;
  /** 走 HF 兜底时全档位共用同一个模型：那条线只有一个模型可配 */
  modelIdFor(spec: LlmModelSpec): string;
  label: string;
};

/**
 * 凭据来源，按优先级：管理端激活的账户 → 环境变量 → 站内已有的 HF 凭据。
 *
 * 最后那条兜底是有意留着的：还没接 OpenRouter 时选区级 AI 也能用，
 * 换上游不需要「先停机再接线」。
 */
export async function getLlmCredentials(): Promise<LlmCredentials | null> {
  const active = await db.llmAccount.findFirst({ where: { isActive: true } }).catch(() => null);
  if (active) {
    return {
      provider: "openrouter",
      apiKey: decryptSecret(active.apiKeyEnc),
      baseUrl: active.baseUrl?.trim() || env.OPENROUTER_BASE_URL,
      modelIdFor: (spec) => spec.openRouterModelId,
      label: `${active.provider} · ${active.label}`,
    };
  }
  if (env.OPENROUTER_API_KEY) {
    return {
      provider: "openrouter",
      apiKey: env.OPENROUTER_API_KEY,
      baseUrl: env.OPENROUTER_BASE_URL,
      modelIdFor: (spec) => spec.openRouterModelId,
      label: "OpenRouter · env",
    };
  }
  const hf = await getActiveHfCredentials();
  if (hf) {
    return {
      provider: "hf",
      apiKey: hf.apiToken,
      baseUrl: hf.baseUrl,
      modelIdFor: () => hf.magicModel,
      label: `HF · ${hf.label}`,
    };
  }
  return null;
}

export async function llmConfigured(): Promise<boolean> {
  return Boolean(await getLlmCredentials());
}

/** LLM 可能跑 30s+，编辑器里等不了这么久（规划 8.2） */
export const LLM_TIMEOUT_MS = 15_000;

export type ChatRequest = {
  system: string;
  user: string;
  /** 已经解析好的模型。这一层不认识「档位」，那是上层的概念 */
  model: LlmModelSpec;
  maxTokens?: number;
  temperature?: number;
  /** 用户点取消时中止。已产生的 token 照样算上游花过的钱 */
  signal?: AbortSignal;
  /**
   * 随请求一起发出去的参考图 URL。
   *
   * 模型读不了图（`model.supportsVision` 为假）时由**调用方**负责不传，
   * 这一层不做判断——它不该知道「为什么这次没有图」，那是业务问题。
   */
  images?: string[];
  /** 出错日志前缀 */
  tag?: string;
};

export type ChatUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  /**
   * 本次真实成本（美元）。**只有上游给了才填**。
   *
   * 拿不到时留空，由调用方决定要不要按本地单价估——不在这里偷偷估：
   * 估算值和真账混在一个字段里，日后对账会分不清哪次是估的。
   */
  costUsd?: number;
  /** costUsd 是估出来的而不是上游给的 */
  costEstimated?: boolean;
};

export type ChatStreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; text: string; usage: ChatUsage; finishReason?: string };

function headersFor(creds: LlmCredentials): Record<string, string> {
  const base: Record<string, string> = {
    Authorization: `Bearer ${creds.apiKey}`,
    "Content-Type": "application/json",
  };
  if (creds.provider === "openrouter") {
    // OpenRouter 的来源标注。缺了也能用，但它的用量面板会认不出是谁在调
    if (env.APP_URL) base["HTTP-Referer"] = env.APP_URL;
    base["X-Title"] = "wanwankewu";
  }
  return base;
}

/**
 * 用户消息。带图时用 OpenAI 那套多模态数组写法。
 *
 * `detail: "low"` 是刻意的：低精度视图（约 512px）足够让模型认出主体、色调、
 * 光线和构图——写提示词要的就是这些。开高精度一张图能顶两三千 token，
 * 比整次改写的其余部分加起来还贵，而多出来的那点材质细节对提示词帮助有限。
 */
function userContent(req: ChatRequest) {
  if (!req.images?.length) return req.user;
  return [
    { type: "text", text: req.user },
    ...req.images.map((url) => ({
      type: "image_url",
      image_url: { url, detail: "low" },
    })),
  ];
}

function bodyFor(creds: LlmCredentials, req: ChatRequest, stream: boolean) {
  return {
    model: creds.modelIdFor(req.model),
    temperature: req.temperature ?? 0.3,
    max_tokens: req.maxTokens ?? 500,
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: userContent(req) },
    ],
    ...(stream
      ? {
          stream: true,
          /*
           * 标准 OpenAI 字段：不加它，流式响应从头到尾都不会带 usage，
           * 于是每一次改写都只能按字符估算 token——直接影响扣点准不准。
           */
          stream_options: { include_usage: true },
          // OpenRouter 扩展：连本次的实际美元成本一起返回，那才是真账
          ...(creds.provider === "openrouter" ? { usage: { include: true } } : {}),
        }
      : {}),
  };
}

/** 把调用方的取消信号和 15s 硬超时并成一个 */
function withTimeout(signal?: AbortSignal): { signal: AbortSignal; done(): void } {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new Error("LLM_TIMEOUT")), LLM_TIMEOUT_MS);
  const onAbort = () => ctl.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) ctl.abort(signal.reason);
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  return {
    signal: ctl.signal,
    done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

function readUsage(raw: ChatStreamChunk["usage"], spec: LlmModelSpec): ChatUsage {
  if (!raw) return {};
  const prompt = raw.prompt_tokens;
  const completion = raw.completion_tokens;
  const total =
    raw.total_tokens ??
    (prompt != null && completion != null ? prompt + completion : undefined);
  if (raw.cost != null) {
    return { promptTokens: prompt, completionTokens: completion, totalTokens: total, costUsd: raw.cost };
  }
  /*
   * 上游没给成本就按本地单价估，并**标记出来**。
   * 「查不到成本」绝不能变成「这次不扣费」——上游的钱已经花了。
   */
  if (prompt != null && completion != null) {
    return {
      promptTokens: prompt,
      completionTokens: completion,
      totalTokens: total,
      costUsd: estimateCostUsd(spec, prompt, completion),
      costEstimated: true,
    };
  }
  return { totalTokens: total };
}

async function post(creds: LlmCredentials, req: ChatRequest, stream: boolean, signal: AbortSignal) {
  const resp = await fetch(`${creds.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: headersFor(creds),
    body: JSON.stringify(bodyFor(creds, req, stream)),
    signal,
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(
      `[${req.tag ?? "llm"}] ${creds.label} ${resp.status}: ${body.slice(0, 300) || resp.statusText}`
    );
  }
  return resp;
}

/**
 * 流式调用。逐段吐 delta，最后一条 done 带全文与用量。
 *
 * delta 是**原始文本**，占位符没还原也没去壳——那两件事跟这一层无关，
 * 由 prompt-rewrite 决定怎么显示。
 */
export async function* streamChat(req: ChatRequest): AsyncGenerator<ChatStreamEvent> {
  const creds = await getLlmCredentials();
  if (!creds) throw new Error("LLM_NOT_CONFIGURED");

  const t = withTimeout(req.signal);
  try {
    const resp = await post(creds, req, true, t.signal);
    const body = resp.body;
    if (!body) throw new Error("LLM_NO_BODY");

    const reader = body.getReader();
    const decoder = new TextDecoder();
    const parser = createSseParser();
    let text = "";
    let usage: ChatUsage = {};
    let finishReason: string | undefined;

    const handle = function* (payloads: string[]): Generator<ChatStreamEvent> {
      for (const payload of payloads) {
        if (payload === "[DONE]") continue;
        let chunk: ChatStreamChunk;
        try {
          chunk = JSON.parse(payload) as ChatStreamChunk;
        } catch {
          // 半截 JSON 不该炸掉整条流；解析器已经保证了事件是完整的，
          // 走到这里说明上游发了非标准内容，跳过比中断更好
          continue;
        }
        if (chunk.error) {
          const message = typeof chunk.error === "string" ? chunk.error : chunk.error.message;
          throw new Error(`[${req.tag ?? "llm"}] upstream: ${message ?? "unknown"}`);
        }
        const choice = chunk.choices?.[0];
        const delta = choice?.delta?.content;
        if (delta) {
          text += delta;
          yield { type: "delta", text: delta };
        }
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        // usage 落在最后一个 chunk 上，那一条的 choices 通常是空数组
        if (chunk.usage) usage = readUsage(chunk.usage, req.model);
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      yield* handle(parser.feed(decoder.decode(value, { stream: true })));
    }
    yield* handle(parser.flush());

    yield { type: "done", text, usage, finishReason };
  } finally {
    t.done();
  }
}

/** 非流式。给不支持流式的模型与降级路径用（规划 8.2） */
export async function chat(
  req: ChatRequest
): Promise<{ text: string; usage: ChatUsage; finishReason?: string } | null> {
  const creds = await getLlmCredentials();
  if (!creds) return null;

  const t = withTimeout(req.signal);
  try {
    const resp = await post(creds, req, false, t.signal);
    const data = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      usage?: ChatStreamChunk["usage"];
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) return null;
    return {
      text,
      usage: readUsage(data.usage, req.model),
      finishReason: data.choices?.[0]?.finish_reason,
    };
  } finally {
    t.done();
  }
}
