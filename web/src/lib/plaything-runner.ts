import "server-only";
import { db } from "./db";
import { env } from "./env";
import { mirrorRemoteUrls } from "./oss";
import { sendTelegram } from "./telegram";
import { ensureDefaultPlaythingProducts } from "./wavespeed-seed";
import { parseModelDefaults } from "./model-schema";
import {
  estimateUnitPrice,
  getAdapter,
  mapProviderStatus,
  PROVIDER_META,
  toProviderId,
} from "./providers";

/**
 * 玩物专区的任务编排。
 *
 * 与渠道无关：提交、轮询、状态归一都走 providers 适配器，
 * 这里只管扣点/退款、内容审查、结果落库这些站内规则。
 */

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export { ensureDefaultPlaythingProducts };

/** 从 apiSchema / override 解析可提交的默认 inputs，合并用户 params */
export function buildPlaythingInputs(
  product: { paramSchemaOverride: string | null; catalogModel?: { apiSchema: string | null } | null },
  prompt: string,
  params: Record<string, unknown>
): Record<string, unknown> {
  const schemaJson = product.paramSchemaOverride || product.catalogModel?.apiSchema;
  const defaults = parseModelDefaults(schemaJson);
  const inputs: Record<string, unknown> = { ...defaults, ...params };
  if (prompt.trim()) {
    inputs.prompt = prompt.trim();
  }
  // 去掉仅本地字段
  delete inputs._local;
  delete inputs.image_base64;
  return inputs;
}

/** 本站报价：仅用 creditCost，永不应用 VIP 折扣 */
export function resolvePlaythingQuote(creditCost: number): { cost: number; discountBps: 0 } {
  return { cost: Math.max(1, Math.floor(creditCost)), discountBps: 0 };
}

export type PlaythingDynamicQuote = {
  cost: number;
  discountBps: 0;
  unit_price_usd: number | null;
  base_price_usd: number;
  credit_cost_base: number;
  source: "provider" | "fallback";
  provider: string;
  provider_label: string;
};

/**
 * 动态报价：cost = round(creditCost * unitPrice / basePriceUsd)
 *
 * 只有拿得到实时单价的渠道才走动态（目前只有 WaveSpeed）。
 * Atlas 没有估价接口，一律退回档位固定扣点——这不是降级失败，
 * 是它本来就按目录基准价计费。永不 VIP 折扣。
 */
export async function resolvePlaythingQuoteDynamic(opts: {
  productId: number;
  inputs: Record<string, unknown>;
}): Promise<PlaythingDynamicQuote> {
  const product = await db.playthingProduct.findFirst({
    where: { id: opts.productId, isActive: true },
    include: { catalogModel: { select: { basePriceUsd: true, modelId: true } } },
  });
  if (!product) throw new Error("模型未上架或不存在");

  const provider = toProviderId(product.provider);
  const credit_cost_base = product.creditCost;
  const base_price_usd = product.catalogModel?.basePriceUsd || 0;

  const unit = await estimateUnitPrice(provider, product.modelId, opts.inputs);
  const shared = {
    discountBps: 0 as const,
    unit_price_usd: unit,
    base_price_usd,
    credit_cost_base,
    provider,
    provider_label: PROVIDER_META[provider].label,
  };

  if (unit != null && unit > 0 && base_price_usd > 0) {
    return {
      ...shared,
      cost: Math.max(1, Math.round((credit_cost_base * unit) / base_price_usd)),
      source: "provider",
    };
  }
  return { ...shared, cost: Math.max(1, Math.floor(credit_cost_base)), source: "fallback" };
}

/** 估价用：把空媒体字段填占位 URL，避免 pricing API 因缺图失败 */
export function inputsForPricing(inputs: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...inputs };
  const placeholderImg = "https://picsum.photos/512/512";
  for (const [k, v] of Object.entries(out)) {
    if (v == null || v === "") {
      if (/image|mask|reference/i.test(k)) out[k] = placeholderImg;
      continue;
    }
    if (Array.isArray(v) && v.length === 0 && /image|reference/i.test(k)) {
      out[k] = [placeholderImg];
    }
  }
  if (!("prompt" in out) || !out.prompt) out.prompt = "pricing estimate";
  return out;
}

export async function processPlaythingGeneration(genId: number): Promise<void> {
  try {
    const gen = await db.playthingGeneration.update({
      where: { id: genId },
      data: { status: "processing", progress: 0 },
      include: {
        product: { include: { catalogModel: true } },
      },
    });

    // 以任务上记的渠道为准：产品事后换绑不能改写历史任务该找谁要结果
    const provider = toProviderId(gen.provider || gen.product.provider);
    const adapter = getAdapter(provider);
    const creds = await adapter.getCredentials();

    if (env.DEMO_MODE || !creds) {
      await sleep(2000);
      await db.playthingGeneration.update({
        where: { id: genId },
        data: {
          status: "succeeded",
          progress: 100,
          resultUrls: JSON.stringify([
            `https://picsum.photos/id/${(genId % 30) + 10}/800/1200`,
          ]),
        },
      });
      return;
    }

    const params = JSON.parse(gen.params || "{}") as Record<string, unknown>;
    let inputs = buildPlaythingInputs(gen.product, gen.prompt, params);

    // 若有本地 base64 图，尽量映射到常见字段 image / image_url
    if (typeof params.image_base64 === "string" && params.image_base64.startsWith("data:")) {
      if (!inputs.image && !inputs.image_url) {
        inputs = { ...inputs, image: params.image_base64 };
      }
    }

    await db.playthingGeneration.update({
      where: { id: genId },
      data: { wsAccountId: creds.accountId, status: "processing", progress: 5 },
    });

    const submitCtx = {
      modelId: gen.product.modelId,
      apiSchema: gen.product.paramSchemaOverride || gen.product.catalogModel?.apiSchema || null,
      type: gen.product.catalogModel?.type ?? "",
    };
    const task = await adapter.submit(creds.apiKey, submitCtx, inputs);
    await db.playthingGeneration.update({
      where: { id: genId },
      data: { externalId: task.id, progress: 10 },
    });

    let mapped = mapProviderStatus(task.status);
    let outputs: string[] = [];
    let thumbnails: string[] = [];
    let lastError: string | undefined;

    for (let i = 0; i < 90; i++) {
      await sleep(i < 10 ? 2000 : 4000);
      const result = await adapter.poll(creds.apiKey, task.id);
      mapped = mapProviderStatus(result.status);
      outputs = result.outputs;
      thumbnails = result.thumbnails;
      lastError = result.error;
      const progress =
        mapped === "succeeded" ? 100 : mapped === "failed" ? gen.progress : Math.min(95, 10 + i * 2);
      await db.playthingGeneration.update({
        where: { id: genId },
        data: {
          status: mapped === "pending" ? "processing" : mapped,
          progress,
          ...(lastError ? { error: lastError.slice(0, 500) } : {}),
        },
      });
      if (mapped === "succeeded" || mapped === "failed") break;
    }

    if (mapped === "succeeded") {
      // 玩物专区尺度最大，结果落库前同样要过绝对红线闸
      const { reviewImages, isAdultContent, safetyAudit } = await import("./content-safety");
      const outSafety = await reviewImages({ urls: outputs, prompt: gen.prompt });
      if (outSafety.level === "prohibited") {
        await db.playthingGeneration
          .update({
            where: { id: genId },
            data: {
              isAdult: true,
              safetyCategories: JSON.stringify([...safetyAudit(outSafety), "blocked_at:生成结果"]),
            },
          })
          .catch(() => undefined);
        sendTelegram(
          `🚨 玩物专区内容审查拦截\n任务 #${genId}\n渠道: ${PROVIDER_META[provider].label}\n用户 ID: ${gen.userId}\n判定: ${outSafety.level} / ${outSafety.categories.join("、") || "—"}\n${outSafety.reason}`
        );
        await failAndRefundPlaything(genId, `生成结果内容审查未通过：${outSafety.reason}`);
        return;
      }

      const finalUrls = await mirrorRemoteUrls(outputs, `plaything/${genId}`);
      await db.playthingGeneration.update({
        where: { id: genId },
        data: {
          status: "succeeded",
          progress: 100,
          isAdult: gen.isAdult || isAdultContent(outSafety),
          resultUrls: JSON.stringify(finalUrls.length ? finalUrls : outputs),
          params: JSON.stringify({
            ...Object.fromEntries(
              Object.entries(params).filter(([k]) => k !== "image_base64")
            ),
            ...(thumbnails.length ? { result_thumb_urls: thumbnails } : {}),
          }),
        },
      });
    } else {
      await failAndRefundPlaything(
        genId,
        lastError || `${PROVIDER_META[provider].label} 生成超时或失败`
      );
    }
  } catch (err) {
    console.error(`[plaything] generation ${genId} error:`, err);
    await failAndRefundPlaything(
      genId,
      err instanceof Error ? err.message : String(err)
    ).catch(() => {});
  }
}

async function failAndRefundPlaything(genId: number, reason?: string) {
  const claimed = await db.playthingGeneration.updateMany({
    where: { id: genId, status: { not: "failed" } },
    data: {
      status: "failed",
      error: reason?.slice(0, 500),
    },
  });
  if (claimed.count === 0) return;

  const gen = await db.playthingGeneration.findUnique({ where: { id: genId } });
  if (!gen) return;

  await db.$transaction([
    db.user.update({ where: { id: gen.userId }, data: { balance: { increment: gen.cost } } }),
    db.transaction.create({
      data: { userId: gen.userId, type: "refund", amount: gen.cost, method: "plaything" },
    }),
  ]);
  sendTelegram(
    `⚠️ 玩物专区生成失败已退款\n任务 #${genId}\n渠道: ${PROVIDER_META[toProviderId(gen.provider)].label}\n用户 ID: ${gen.userId}\n退回点数: ${gen.cost}${
      reason ? `\n原因: ${reason.slice(0, 120)}` : ""
    }`
  );
}
