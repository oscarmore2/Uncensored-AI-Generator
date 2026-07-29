import "server-only";
import { randomUUID } from "crypto";
import { db } from "./db";
import { env } from "./env";
import { sendTelegram } from "./telegram";
import { mirrorRemoteUrls, ossConfigured, uploadBufferWithMeta } from "./oss";
import {
  estimatePricing,
  getActiveWaveSpeedCredentials,
  mapWaveSpeedStatus,
  pollWaveSpeedResult,
  submitWaveSpeedTask,
} from "./wavespeed";
import { buildProviderInputs, inputsForPricing, parseRequestSchema } from "./generation-bridge";
import { modeNeedsImage } from "./generation-modes";
import { isAdultContent, reviewImages, safetyAudit } from "./content-safety";
import {
  applySourceAspectToInputs,
  readImageDimsFromDataUrl,
} from "./undress-geometry";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function generationProviderConfigured(): Promise<boolean> {
  return Boolean(await getActiveWaveSpeedCredentials());
}

/** data URL → 对象存储公开 URL。OSS 未配置时退回原 data URL 交给上游自行解析。 */
async function materializeReferenceImage(
  userId: number,
  dataUrl: string
): Promise<string> {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) return dataUrl;
  const contentType = match[1] || "image/jpeg";
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length < 32) throw new Error("参考图数据无效");
  if (buffer.length > 20 * 1024 * 1024) throw new Error("参考图超过 20MB 限制");

  if (!(await ossConfigured())) return dataUrl;

  const ext = contentType.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "jpg";
  const uploaded = await uploadBufferWithMeta(
    buffer,
    `generations/${userId}/${randomUUID()}.${ext}`,
    contentType
  );
  return uploaded.url;
}

/**
 * 后台执行生成任务：提交到 WaveSpeed 并轮询写回进度。
 * 调用方不 await（fire-and-forget）。
 */
export async function processGeneration(genId: number): Promise<void> {
  try {
    const gen = await db.generation.update({
      where: { id: genId },
      data: { status: "processing", progress: 0 },
    });

    const creds = await getActiveWaveSpeedCredentials();
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
        },
      });
      return;
    }

    const params = JSON.parse(gen.params) as Record<string, unknown>;

    const product = gen.productId
      ? await db.generationProduct.findUnique({ where: { id: gen.productId } })
      : null;
    if (!product) throw new Error("下单时的档位已不存在，请重新提交");
    if (!product.providerModelId.trim()) {
      throw new Error(`档位「${product.label}」尚未绑定生成模型，请联系管理员`);
    }

    let imageUrl: string | null = null;
    let sourceDims: { width: number; height: number } | null = null;
    if (modeNeedsImage(gen.mode)) {
      const raw = params.image_base64;
      if (typeof raw !== "string" || !raw) throw new Error("该模式需要上传参考图片");
      if (gen.mode === "undress") {
        sourceDims = readImageDimsFromDataUrl(raw);
      }
      imageUrl = await materializeReferenceImage(gen.userId, raw);

      // 参考图必须过闸再提交上游：文本分类器看不见像素，
      // 一张真人未成年照片配无害提示词能穿透纯文本审查
      const refSafety = await reviewImages({ urls: [imageUrl], prompt: gen.prompt });
      if (refSafety.level === "prohibited") {
        await recordSafetyBlock(genId, gen.userId, "参考图", refSafety);
        await failAndRefund(genId, `参考图内容审查未通过：${refSafety.reason}`);
        return;
      }
      if (isAdultContent(refSafety) && !gen.isAdult) {
        await db.generation.update({ where: { id: genId }, data: { isAdult: true } });
      }
    }

    const [catalogModel, mappings] = await Promise.all([
      db.waveSpeedCatalogModel.findUnique({
        where: { modelId: product.providerModelId },
        select: { apiSchema: true },
      }),
      db.modeParamMapping.findMany({
        where: { mode: gen.mode, enabled: true },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      }),
    ]);

    const { inputs, snapped } = buildProviderInputs({
      product,
      apiSchema: catalogModel?.apiSchema ?? null,
      prompt: gen.prompt,
      negativePrompt: gen.negativePrompt ?? "",
      imageUrl,
      uiParams: params,
      mappings,
    });

    // 脱衣模式：用原图像素尺寸覆盖 size/aspect_ratio，杜绝默认方图拉伸
    if (gen.mode === "undress" && sourceDims) {
      const schema = parseRequestSchema(catalogModel?.apiSchema ?? null);
      const written = applySourceAspectToInputs(inputs, schema, sourceDims);
      if (written.length) {
        console.info(
          `[generation] ${genId} undress 保留原图比例 ${sourceDims.width}x${sourceDims.height} → ${written.join(",")}`
        );
      }
    }

    if (snapped.length) {
      // 计费按用户选的时长算，实际生成用模型允许的最近值，两者不一致时留痕便于对账
      console.warn(
        `[generation] ${genId} 参数被模型 schema 收敛:`,
        snapped.map((s) => `${s.key} ${String(s.from)}→${String(s.to)}`).join(", ")
      );
    }

    await db.generation.update({
      where: { id: genId },
      data: { wsAccountId: creds.accountId, status: "queued", progress: 5 },
    });

    const task = await submitWaveSpeedTask(creds.apiKey, product.providerModelId, inputs);
    await db.generation.update({
      where: { id: genId },
      data: {
        providerJobId: task.id,
        status: mapWaveSpeedStatus(task.status) === "pending" ? "queued" : "processing",
        progress: 10,
      },
    });

    let mapped = mapWaveSpeedStatus(task.status);
    let outputs: string[] = [];
    let lastError: string | undefined;

    for (let i = 0; i < 90; i++) {
      await sleep(i < 10 ? 2500 : 4500);
      const result = await pollWaveSpeedResult(creds.apiKey, task.id);
      mapped = mapWaveSpeedStatus(result.status);
      outputs = result.outputs;
      lastError = result.error;

      await db.generation.update({
        where: { id: genId },
        data: {
          status: mapped === "pending" ? "queued" : mapped,
          progress: mapped === "succeeded" ? 100 : Math.min(95, 10 + i * 2),
          ...(lastError ? { providerError: lastError.slice(0, 500) } : {}),
        },
      });
      if (mapped === "succeeded" || mapped === "failed") break;
    }

    if (mapped === "succeeded" && outputs.length > 0) {
      // 结果落库前先过闸：模型可能产出提示词里没有的内容，
      // 这是纯提示词审查抓不到的一层，也是 CSAM 的最后一道防线
      const outSafety = await reviewImages({ urls: outputs, prompt: gen.prompt });
      if (outSafety.level === "prohibited") {
        await recordSafetyBlock(genId, gen.userId, "生成结果", outSafety);
        await failAndRefund(genId, `生成结果内容审查未通过：${outSafety.reason}`);
        return;
      }
      const resultIsAdult = gen.isAdult || isAdultContent(outSafety);

      const finalUrls = await mirrorRemoteUrls(outputs, `generations/${genId}`);
      const costUsd = await estimatePricing(
        product.providerModelId,
        inputsForPricing(inputs, catalogModel?.apiSchema ?? null)
      ).catch(() => null);

      await db.generation.update({
        where: { id: genId },
        data: {
          status: "succeeded",
          progress: 100,
          resultUrls: JSON.stringify(finalUrls.length ? finalUrls : outputs),
          isAdult: resultIsAdult,
          safetyCategories: JSON.stringify(
            Array.from(new Set([...safeCategories(gen.safetyCategories), ...safetyAudit(outSafety)]))
          ),
          ...(costUsd != null ? { providerCostUsd: costUsd } : {}),
          // 清掉大体积 base64，只留可复现的档位与参数
          params: JSON.stringify({
            ratio: params.ratio,
            duration: params.duration,
            batch: typeof params.batch === "number" ? params.batch : 1,
            tier: gen.tier,
            spicy: gen.spicy,
            product_id: product.id,
          }),
        },
      });
    } else {
      await failAndRefund(genId, lastError || "生成超时或未返回结果");
    }
  } catch (err) {
    console.error(`[generation] ${genId} error:`, err);
    await failAndRefund(genId, err instanceof Error ? err.message : String(err)).catch(() => {});
  } finally {
    await stripReferenceImage(genId);
  }
}

/** 解析已存的审查留痕，损坏时按空处理 */
function safeCategories(raw: string): string[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * 图像审查判定为绝对红线时留痕并告警。
 * 这类命中极少但性质严重，必须让管理员当场看到、能立刻处置账号。
 */
async function recordSafetyBlock(
  genId: number,
  userId: number,
  stage: string,
  safety: { level: string; categories: string[]; reason: string; source: string }
): Promise<void> {
  await db.generation
    .update({
      where: { id: genId },
      data: {
        isAdult: true,
        visibility: "hidden",
        safetyCategories: JSON.stringify([
          ...safety.categories,
          `level:${safety.level}`,
          `source:${safety.source}`,
          `blocked_at:${stage}`,
        ]),
      },
    })
    .catch(() => undefined);

  sendTelegram(
    `🚨 内容审查拦截（${stage}）\n任务 #${genId}\n用户 ID: ${userId}\n判定: ${safety.level} / ${safety.categories.join("、") || "—"}\n来源: ${safety.source}\n${safety.reason}`
  );
}

/** 任务收尾时移除库里的 base64，避免长期占用存储 */
async function stripReferenceImage(genId: number): Promise<void> {
  const current = await db.generation
    .findUnique({ where: { id: genId }, select: { params: true } })
    .catch(() => null);
  if (!current) return;
  try {
    const params = JSON.parse(current.params) as Record<string, unknown>;
    if (!("image_base64" in params)) return;
    delete params.image_base64;
    await db.generation.update({
      where: { id: genId },
      data: { params: JSON.stringify(params) },
    });
  } catch {
    // 参数损坏不阻断收尾
  }
}

async function failAndRefund(genId: number, reason?: string) {
  // 原子抢占：只有第一个把状态转为 failed 的调用会退款
  const claimed = await db.generation.updateMany({
    where: { id: genId, status: { not: "failed" } },
    data: { status: "failed", providerError: reason?.slice(0, 500) },
  });
  if (claimed.count === 0) return;

  const gen = await db.generation.findUnique({ where: { id: genId } });
  if (!gen) return;

  await db.$transaction([
    db.user.update({ where: { id: gen.userId }, data: { balance: { increment: gen.cost } } }),
    db.transaction.create({ data: { userId: gen.userId, type: "refund", amount: gen.cost } }),
  ]);
  sendTelegram(
    `⚠️ 生成失败已退款\n任务 #${genId} (${gen.mode} / ${gen.tier}${gen.spicy ? " spicy" : ""})\n用户 ID: ${gen.userId}\n退回点数: ${gen.cost}${
      reason ? `\n原因: ${reason.slice(0, 120)}` : ""
    }`
  );
}
