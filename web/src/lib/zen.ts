import "server-only";
import { env } from "./env";
import { db } from "./db";
import { sendTelegram } from "./telegram";
import { decryptSecret } from "./secret-crypto";
import { mirrorRemoteUrls } from "./oss";

const COST_MAP: Record<string, number> = {
  txt2img: 2,
  txt2vid: 15,
  img2img: 3,
  img2vid: 20,
};

export function generationCost(mode: string, batch: number): number {
  const base = COST_MAP[mode] ?? 2;
  return Math.floor(base * (batch === 4 ? 1.5 : 1));
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
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Zen API ${path} failed: ${resp.status} ${body.slice(0, 200)}`);
  }
  return resp.json();
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

function zenToolAndInput(
  mode: string,
  prompt: string,
  params: { ratio?: string; negative_prompt?: string; quality?: string },
  imageAssetId: string | null
): { tool: string; input: Record<string, unknown> } {
  const ratio = params.ratio ?? "1:1";
  switch (mode) {
    case "txt2img":
      return {
        tool: "by_prompt",
        input: {
          positive_prompt: prompt,
          negative_prompt: params.negative_prompt ?? "",
          model: env.DEMO_MODE ? "GENERAL_NSFW" : "SDXL_NSFW",
          ratio,
          mode: params.quality ?? "quality",
        },
      };
    case "img2img":
      return {
        tool: "image_editor",
        input: {
          image_assets: imageAssetId ? [imageAssetId] : [],
          prompt,
          model: "SDXL_NSFW",
          ratio,
        },
      };
    case "txt2vid":
      return {
        tool: "text_to_video",
        input: {
          prompt,
          model: env.DEMO_MODE ? "seedance_2_0" : "wan@2.7-nsfw",
          duration: 5,
          resolution: "1280x720",
        },
      };
    case "img2vid":
      return {
        tool: "videogen",
        input: { ref_asset: imageAssetId, prompt, model: "wan@2.7-nsfw", duration: 4 },
      };
    default:
      return { tool: "by_prompt", input: { positive_prompt: prompt } };
  }
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

    const params = JSON.parse(gen.params) as { ratio?: string; quality?: string };
    const { tool, input } = zenToolAndInput(
      gen.mode,
      gen.prompt,
      { ...params, negative_prompt: gen.negativePrompt ?? "" },
      null
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
