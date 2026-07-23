import "server-only";
import { env } from "./env";
import { db } from "./db";
import { sendTelegram } from "./telegram";
import { decryptSecret } from "./secret-crypto";
import { mirrorRemoteUrls } from "./oss";
import {
  buildZenInputFromMappings,
  resolveGenerationProduct,
} from "./pricing";
import type { GenerationProduct } from "@prisma/client";

/** @deprecated 请用 resolveGenerationQuote；保留给旧调用临时兼容 */
export async function generationCost(mode: string, batch: number): Promise<number> {
  const { resolveGenerationQuote } = await import("./pricing");
  const quote = await resolveGenerationQuote({ mode, batch });
  return quote.cost;
}

export interface ZenCredentials {
  apiKey: string;
  accountId: number | null;
  source: "db" | "env";
  label?: string;
}

/** 优先使用管理端激活的 Zen 账户；无激活时回退到 .env */
export async function getActiveZenCredentials(): Promise<ZenCredentials | null> {
  const active = await db.zenAccount.findFirst({ where: { isActive: true } });
  if (active) {
    return {
      apiKey: decryptSecret(active.apiKeyEnc),
      accountId: active.id,
      source: "db",
      label: active.label,
    };
  }
  if (env.ZEN_API_KEY) {
    return { apiKey: env.ZEN_API_KEY, accountId: null, source: "env", label: "env" };
  }
  return null;
}

export async function zenConfigured(): Promise<boolean> {
  return Boolean(await getActiveZenCredentials());
}

async function zenFetchWithKey(
  apiKey: string,
  path: string,
  init?: RequestInit
): Promise<Record<string, unknown>> {
  const resp = await fetch(`${env.ZEN_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "AVClubs/1.0 (+https://avclubs; zen-api-client)",
      ...(env.ZEN_PROXY_SECRET ? { "X-Zen-Proxy-Secret": env.ZEN_PROXY_SECRET } : {}),
      ...init?.headers,
    },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    if (isCloudflareChallenge(resp.status, body)) {
      throw new Error(
        `Zen API 被 Cloudflare 拦截（403 挑战页）。常见于 Railway/云主机机房 IP。` +
          `请把 ZEN_BASE_URL 改为 Cloudflare Worker 代理地址（见 scripts/zen-proxy-worker.js），` +
          `或联系 Zen 支持放行你的出口 IP。当前 Base: ${env.ZEN_BASE_URL}`
      );
    }
    throw new Error(`Zen API ${path} failed: ${resp.status} ${body.slice(0, 200)}`);
  }
  const contentType = resp.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const body = await resp.text().catch(() => "");
    if (isCloudflareChallenge(resp.status, body)) {
      throw new Error(
        `Zen API 返回了 Cloudflare 挑战页而非 JSON。请配置 Worker 代理（ZEN_BASE_URL）。`
      );
    }
    throw new Error(`Zen API ${path} 返回非 JSON: ${body.slice(0, 120)}`);
  }
  return resp.json();
}

/** Cloudflare Bot Fight / Managed Challenge HTML */
function isCloudflareChallenge(status: number, body: string): boolean {
  if (status !== 403 && status !== 503) {
    // 有时 CF 仍返回 200 HTML 挑战页
    return /Just a moment|cf-browser-verification|__cf_chl_|challenge-platform/i.test(body);
  }
  return /Just a moment|cf-browser-verification|__cf_chl_|challenge-platform|<!DOCTYPE html/i.test(body);
}

export function isZenCloudflareBlockedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /Cloudflare|Worker 代理|挑战页/i.test(msg);
}

/** 拉取 Zen 账户真实余额并写回 DB（仅 DB 账户） */
export async function syncZenAccountBalance(accountId: number): Promise<number> {
  const account = await db.zenAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new Error("Zen account not found");
  const apiKey = decryptSecret(account.apiKeyEnc);
  const data = await zenFetchWithKey(apiKey, "/balance");
  const credits = Number(data.credits);
  if (!Number.isFinite(credits)) throw new Error("Invalid balance response");
  await db.zenAccount.update({
    where: { id: accountId },
    data: { lastKnownBalance: credits, lastBalanceSyncedAt: new Date() },
  });
  return credits;
}

/** 用任意 key 测余额（添加账户时校验） */
export async function fetchZenBalanceWithKey(apiKey: string): Promise<number> {
  const data = await zenFetchWithKey(apiKey, "/balance");
  const credits = Number(data.credits);
  if (!Number.isFinite(credits)) throw new Error("Invalid balance response");
  return credits;
}

interface ZenJob {
  id: string;
  status: string;
  progress?: number;
  error?: string | null;
}

async function zenToolAndInput(
  mode: string,
  prompt: string,
  params: Record<string, unknown>,
  imageAssetId: string | null,
  product: GenerationProduct
): Promise<{ tool: string; input: Record<string, unknown> }> {
  const mapped = await buildZenInputFromMappings(mode, params, product);
  const negative = typeof params.negative_prompt === "string" ? params.negative_prompt : "";

  switch (mode) {
    case "txt2img":
      return {
        tool: product.zenTool,
        input: {
          positive_prompt: prompt,
          negative_prompt: negative,
          ...mapped,
          model: product.zenModel,
        },
      };
    case "img2img":
      return {
        tool: product.zenTool,
        input: {
          image_assets: imageAssetId ? [imageAssetId] : [],
          prompt,
          ...mapped,
          model: product.zenModel,
        },
      };
    case "txt2vid":
      return {
        tool: product.zenTool,
        input: {
          prompt,
          duration: 5,
          resolution: "1280x720",
          ...mapped,
          model: product.zenModel,
        },
      };
    case "img2vid":
      return {
        tool: product.zenTool,
        input: {
          ref_asset: imageAssetId,
          prompt,
          duration: 4,
          ...mapped,
          model: product.zenModel,
        },
      };
    case "undress": {
      if (!imageAssetId) throw new Error("脱衣功能需要上传图片");
      return {
        tool: product.zenTool,
        input: { image_asset: imageAssetId },
      };
    }
    default:
      return {
        tool: product.zenTool || "by_prompt",
        input: { positive_prompt: prompt, ...mapped, model: product.zenModel },
      };
  }
}

/** 将 data URL / base64 上传到 Zen，返回 asset_id */
async function uploadZenAsset(apiKey: string, imageBase64: string): Promise<string> {
  const match = imageBase64.match(/^data:([^;]+);base64,(.+)$/s);
  const mediaType = match?.[1] ?? "image/jpeg";
  const raw = match?.[2] ?? imageBase64.replace(/^data:[^;]+;base64,/, "");
  const buffer = Buffer.from(raw, "base64");
  if (buffer.length < 32) throw new Error("图片数据无效");
  if (buffer.length > 50 * 1024 * 1024) throw new Error("图片超过 Zen 50MB 限制");

  const form = new FormData();
  form.append("media_type", mediaType);
  form.append("file", new Blob([new Uint8Array(buffer)], { type: mediaType }), `upload.${mediaType.split("/")[1] ?? "jpg"}`);

  const resp = await fetch(`${env.ZEN_BASE_URL}/assets`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "User-Agent": "AVClubs/1.0 (+https://avclubs; zen-api-client)",
      ...(env.ZEN_PROXY_SECRET ? { "X-Zen-Proxy-Secret": env.ZEN_PROXY_SECRET } : {}),
    },
    body: form,
  });

  const body = await resp.text().catch(() => "");
  if (!resp.ok) {
    if (isCloudflareChallenge(resp.status, body)) {
      throw new Error("Zen 资源上传被 Cloudflare 拦截，请配置 Worker 代理");
    }
    throw new Error(`Zen 上传图片失败: ${resp.status} ${body.slice(0, 200)}`);
  }
  const data = JSON.parse(body) as { asset_id?: string };
  if (!data.asset_id) throw new Error("Zen 上传未返回 asset_id");
  return data.asset_id;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mapZenStatus(status: string): string {
  if (["queued", "processing", "succeeded", "partial", "failed"].includes(status)) return status;
  return "processing";
}

/**
 * 后台处理生成任务：Demo 模式返回占位图，真实模式调用 Zen 并轮询（写入 progress）。
 * 调用方不 await（fire-and-forget）。
 */
export async function processGeneration(genId: number): Promise<void> {
  try {
    const gen = await db.generation.update({
      where: { id: genId },
      data: { status: "processing", progress: 0 },
    });

    const creds = await getActiveZenCredentials();
    if (env.DEMO_MODE || !creds) {
      await sleep(2500);
      await db.generation.update({
        where: { id: genId },
        data: {
          status: "succeeded",
          progress: 100,
          resultUrls: JSON.stringify([
            `https://picsum.photos/id/${(genId % 30) + 10}/800/1200`,
            `https://picsum.photos/id/${(genId % 30) + 20}/800/1200`,
          ]),
          zenCreditsCost: Math.round(gen.cost * env.ZEN_CREDIT_RATIO),
        },
      });
      return;
    }

    const params = JSON.parse(gen.params) as Record<string, unknown>;

    let imageAssetId: string | null = null;
    const needsAsset = ["img2img", "img2vid", "undress"].includes(gen.mode);
    if (needsAsset) {
      if (!params.image_base64 || typeof params.image_base64 !== "string") {
        throw new Error("该模式需要上传参考图片");
      }
      imageAssetId = await uploadZenAsset(creds.apiKey, params.image_base64);
    }

    const product = await resolveGenerationProduct({
      mode: gen.mode,
      zenModel: typeof params.zen_model === "string" ? params.zen_model : null,
      variantKey: typeof params.undress_variant === "string" ? params.undress_variant : null,
    });

    const { tool, input } = await zenToolAndInput(
      gen.mode,
      gen.prompt,
      { ...params, negative_prompt: gen.negativePrompt ?? "" },
      imageAssetId,
      product
    );

    // 绑定账户 + 创建 Zen task，建立本地 Generation.id ↔ zenJobId 映射
    await db.generation.update({
      where: { id: genId },
      data: { zenAccountId: creds.accountId, status: "queued", progress: 0 },
    });

    const job = (await zenFetchWithKey(creds.apiKey, "/generations", {
      method: "POST",
      body: JSON.stringify({ tool, input }),
      headers: { "Idempotency-Key": `avclubs-gen-${genId}` },
    })) as unknown as ZenJob;

    await db.generation.update({
      where: { id: genId },
      data: {
        zenJobId: job.id,
        status: mapZenStatus(job.status),
        progress: typeof job.progress === "number" ? job.progress : 5,
      },
    });

    // Zen 暂无 webhook，轮询 status 并实时写 progress
    let status = mapZenStatus(job.status);
    for (let i = 0; i < 60; i++) {
      await sleep(5000);
      const s = (await zenFetchWithKey(
        creds.apiKey,
        `/generations/${encodeURIComponent(job.id)}`
      )) as unknown as ZenJob;
      status = mapZenStatus(s.status);
      const progress =
        typeof s.progress === "number"
          ? s.progress
          : status === "succeeded" || status === "partial"
            ? 100
            : Math.min(95, 10 + i * 3);

      await db.generation.update({
        where: { id: genId },
        data: {
          status,
          progress,
          ...(s.error ? { zenError: String(s.error).slice(0, 500) } : {}),
        },
      });

      if (status === "succeeded" || status === "partial" || status === "failed") break;
    }

    if (status === "succeeded" || status === "partial") {
      const result = await zenFetchWithKey(
        creds.apiKey,
        `/generations/${encodeURIComponent(job.id)}/result`
      );
      const outputs = (result.outputs ?? []) as Array<{ download_url?: string; url?: string }>;
      const urls = outputs.map((o) => o.download_url ?? o.url).filter(Boolean) as string[];
      const finalUrls = await mirrorRemoteUrls(urls, `generations/${genId}`);
      const zenCreditsCost = Math.round(gen.cost * env.ZEN_CREDIT_RATIO);
      await db.generation.update({
        where: { id: genId },
        data: {
          status: status === "partial" ? "partial" : "succeeded",
          progress: 100,
          resultUrls: JSON.stringify(finalUrls),
          zenCreditsCost,
          // 清除大体积 base64，避免长期占库
          params: JSON.stringify({
            ratio: params.ratio,
            quality: params.quality,
            style: params.style,
            duration: params.duration,
            resolution: params.resolution,
            undress_variant: params.undress_variant,
            zen_model: product.zenModel,
            product_id: product.id,
            batch: typeof params.batch === "number" ? params.batch : 1,
          }),
        },
      });
      // 成功后异步刷新账户余额（不阻塞）
      if (creds.accountId) {
        void syncZenAccountBalance(creds.accountId).catch((err) =>
          console.warn("[zen] balance sync after generation failed:", err)
        );
      }
    } else {
      await failAndRefund(genId, "Zen generation timed out or failed");
    }
  } catch (err) {
    console.error(`[zen] generation ${genId} error:`, err);
    await failAndRefund(genId, err instanceof Error ? err.message : String(err)).catch(() => {});
  }
}

/**
 * 采集导入用：按 Zen job id 拉取第一个结果 URL。
 * 使用激活账户（或 env）；失败返回 null。
 */
export async function fetchZenResultUrl(jobId: string): Promise<string | null> {
  const creds = await getActiveZenCredentials();
  if (!creds) return null;
  try {
    const result = await zenFetchWithKey(
      creds.apiKey,
      `/generations/${encodeURIComponent(jobId)}/result`
    );
    const outputs = (result.outputs ?? []) as Array<{ download_url?: string; url?: string }>;
    return (outputs.map((o) => o.download_url ?? o.url).find(Boolean) as string | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * 预留：若日后 Zen 支持 webhook，可回调此逻辑按 zenJobId 更新本地任务。
 * 当前由轮询调用同等更新路径。
 */
export async function applyZenJobUpdate(params: {
  zenJobId: string;
  status: string;
  progress?: number;
  error?: string | null;
  resultUrls?: string[] | null;
}): Promise<boolean> {
  const gen = await db.generation.findFirst({ where: { zenJobId: params.zenJobId } });
  if (!gen) return false;
  if (gen.status === "succeeded" || gen.status === "failed") return false;

  const status = mapZenStatus(params.status);
  let resultUrls = params.resultUrls ?? undefined;
  if (resultUrls?.length) {
    resultUrls = await mirrorRemoteUrls(resultUrls, `generations/${gen.id}`);
  }
  await db.generation.update({
    where: { id: gen.id },
    data: {
      status,
      progress:
        typeof params.progress === "number"
          ? params.progress
          : status === "succeeded" || status === "partial"
            ? 100
            : gen.progress,
      ...(params.error ? { zenError: params.error.slice(0, 500) } : {}),
      ...(resultUrls ? { resultUrls: JSON.stringify(resultUrls) } : {}),
    },
  });

  if (status === "failed") {
    await failAndRefund(gen.id, params.error ?? "failed via webhook").catch(() => {});
  }
  return true;
}

async function failAndRefund(genId: number, reason?: string) {
  const gen = await db.generation.findUnique({ where: { id: genId } });
  if (!gen || gen.status === "failed") return;
  await db.$transaction([
    db.generation.update({
      where: { id: genId },
      data: {
        status: "failed",
        progress: gen.progress,
        zenError: reason?.slice(0, 500) ?? gen.zenError,
      },
    }),
    db.user.update({ where: { id: gen.userId }, data: { balance: { increment: gen.cost } } }),
    db.transaction.create({ data: { userId: gen.userId, type: "refund", amount: gen.cost } }),
  ]);
  sendTelegram(
    `⚠️ 生成失败已退款\n任务 #${genId} (${gen.mode})\n用户 ID: ${gen.userId}\n退回点数: ${gen.cost}${reason ? `\n原因: ${reason.slice(0, 120)}` : ""}`
  );
}
