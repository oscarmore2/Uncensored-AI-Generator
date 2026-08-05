import "server-only";
import { randomUUID } from "crypto";
import { db } from "./db";
import { env } from "./env";
import { sendTelegram } from "./telegram";
import { mirrorRemoteUrls, ossConfigured, uploadBufferWithMeta } from "./oss";
import {
  anyProviderConfigured,
  estimateUnitPrice,
  getAdapter,
  mapProviderStatus,
  PROVIDER_META,
  toProviderId,
} from "./providers";
import { buildProviderInputs, inputsForPricing, parseRequestSchema } from "./generation-bridge";
import { modeNeedsMedia } from "./generation-modes";
import { isAdultContent, reviewImages, safetyAudit } from "./content-safety";
import {
  applySourceAspectToInputs,
  readImageDimsFromDataUrl,
} from "./undress-geometry";
import { sanitizeFilename } from "./media-delete-reason";
import { createMediaAssetCompat } from "./media-asset-compat";
import { uploadMediaExpiry } from "./media-retention";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function generationProviderConfigured(): Promise<boolean> {
  return anyProviderConfigured();
}

/**
 * data URL → 对象存储公开 URL。OSS 未配置时退回原 data URL 交给上游自行解析。
 *
 * 上传的同时登记一条 MediaAsset：
 * - 任务收尾会把 base64 从 params 里删掉，不登记的话这张图就再也找不回来，
 *   「套用」也就没法把参考图带回来；
 * - 清理任务是按 MediaAsset 扫的，不登记等于在 OSS 里留下永不回收的孤儿文件。
 */
async function materializeReferenceImage(
  userId: number,
  genId: number,
  dataUrl: string,
  filename: string | null
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

  try {
    await createMediaAssetCompat({
      userId,
      kind: "upload",
      channel: "main",
      url: uploaded.url,
      objectKey: uploaded.objectKey,
      contentType,
      bytes: buffer.length,
      filename: sanitizeFilename(filename),
      sourceId: genId,
      retentionAssigned: true,
      expiresAt: await uploadMediaExpiry(),
    });
  } catch (err) {
    // 登记失败不该让已经付过费的生成任务挂掉，退化成旧行为（图还能用，只是没进清理台账）
    console.warn("[generation] 参考图 MediaAsset 登记失败：", err);
  }

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

    if (env.DEMO_MODE) {
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

    // 渠道由档位决定；凭据必须在这之后才取得到
    const provider = toProviderId(product.provider);
    const adapter = getAdapter(provider);
    const creds = await adapter.getCredentials();
    // 没配 Key 就直接失败退款。以前这里会静默返回占位图，
    // 单渠道时那只发生在开发机上；现在管理员可能把档位绑到没配 Key 的渠道，
    // 再吐占位图就是收了钱给假图
    if (!creds) {
      throw new Error(`档位「${product.label}」所属渠道 ${PROVIDER_META[provider].label} 尚未配置 API Key`);
    }
    await db.generation.update({ where: { id: genId }, data: { provider } });

    // 按字段提交的输入媒体（新链路）：对口型的视频+音频、换脸的视频+人脸图、
    // reference-to-video 的多张图，都在这里
    const mediaFields = parseMediaFields(params.media_fields);

    let imageUrl: string | null = null;
    let sourceDims: { width: number; height: number } | null = null;
    if (modeNeedsMedia(gen.mode) && Object.keys(mediaFields).length === 0) {
      // 旧链路：单张 base64 参考图。套用历史任务时没有 base64，
      // 直接复用上次那张已在对象存储里的图
      const reused =
        Array.isArray(params.input_urls) && typeof params.input_urls[0] === "string"
          ? (params.input_urls[0] as string)
          : null;
      const raw =
        typeof params.image_base64 === "string" && params.image_base64
          ? params.image_base64
          : reused;
      if (!raw) throw new Error("该模式需要上传输入媒体");
      if (gen.mode === "undress") {
        sourceDims = readImageDimsFromDataUrl(raw);
      }
      const inputName =
        typeof params.image_filename === "string" ? params.image_filename : null;
      imageUrl = await materializeReferenceImage(gen.userId, genId, raw, inputName);
      // 落进 params：收尾会删掉 base64，届时只剩这个 URL 能指认当初用的是哪张图
      await persistInputUrls(genId, [imageUrl]);
    }

    // 输入媒体必须过闸再提交上游：文本分类器看不见像素，
    // 一张真人未成年照片配无害提示词能穿透纯文本审查。
    // 只送图片去审查——视频/音频这两类分类器看不了，硬送只会白等一轮超时
    const reviewUrls = [
      ...(imageUrl ? [imageUrl] : []),
      ...Object.entries(mediaFields)
        .filter(([field]) => !/(video|audio|voice|speech|music)/i.test(field))
        .flatMap(([, urls]) => urls),
    ];
    if (reviewUrls.length) {
      const refSafety = await reviewImages({ urls: reviewUrls, prompt: gen.prompt });
      if (refSafety.level === "prohibited") {
        await recordSafetyBlock(genId, gen.userId, "输入媒体", refSafety);
        await failAndRefund(genId, `输入媒体内容审查未通过：${refSafety.reason}`);
        return;
      }
      if (isAdultContent(refSafety) && !gen.isAdult) {
        await db.generation.update({ where: { id: genId }, data: { isAdult: true } });
      }
    }

    const [catalogModel, mappings] = await Promise.all([
      db.providerCatalogModel.findUnique({
        where: { provider_modelId: { provider, modelId: product.providerModelId } },
        select: { apiSchema: true, type: true },
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
      mediaFields,
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

    const task = await adapter.submit(
      creds.apiKey,
      {
        modelId: product.providerModelId,
        apiSchema: catalogModel?.apiSchema ?? null,
        type: catalogModel?.type ?? "",
      },
      inputs
    );
    await db.generation.update({
      where: { id: genId },
      data: {
        providerJobId: task.id,
        status: mapProviderStatus(task.status) === "pending" ? "queued" : "processing",
        progress: 10,
      },
    });

    let mapped = mapProviderStatus(task.status);
    let outputs: string[] = [];
    let thumbnails: string[] = [];
    let lastError: string | undefined;

    for (let i = 0; i < 90; i++) {
      await sleep(i < 10 ? 2500 : 4500);
      const result = await adapter.poll(creds.apiKey, task.id);
      mapped = mapProviderStatus(result.status);
      outputs = result.outputs;
      thumbnails = result.thumbnails;
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
      // 拿不到实时单价（Atlas 没有这个接口）时留空，成本看板会退回目录基准价
      const costUsd = await estimateUnitPrice(
        provider,
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
          // 清掉大体积 base64，其余原样留着：
          // 「套用」要靠它复原 gender / undress_options / 模型额外参数，
          // input_urls 则是参考图被 base64 清掉后唯一的线索
          params: JSON.stringify(reproducibleParams(params, {
            tier: gen.tier,
            spicy: gen.spicy,
            productId: product.id,
            inputUrls: imageUrl ? [imageUrl] : [],
            thumbUrls: thumbnails,
          })),
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

/** 解析 params.media_fields：{ 字段名: [URL, …] }，形状不对的一律丢掉 */
function parseMediaFields(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string[]> = {};
  for (const [field, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    const urls = value.filter(
      (u): u is string => typeof u === "string" && /^https?:\/\//i.test(u)
    );
    if (urls.length) out[field] = urls;
  }
  return out;
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

/**
 * 成功收尾时要落库的参数：原样保留用户可复现的选择，只丢掉大体积的 base64。
 * 早期实现只留 ratio/duration/batch，导致脱衣的性别与高级选项、
 * 以及模型专属的额外参数在任务结束后就查不到了，「套用」也就复原不出来。
 */
function reproducibleParams(
  params: Record<string, unknown>,
  extra: {
    tier: string;
    spicy: boolean;
    productId: number;
    inputUrls: string[];
    thumbUrls: string[];
  }
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...params };
  delete out.image_base64;
  out.tier = extra.tier;
  out.spicy = extra.spicy;
  out.product_id = extra.productId;
  if (extra.inputUrls.length) out.input_urls = extra.inputUrls;
  if (extra.thumbUrls.length) out.result_thumb_urls = extra.thumbUrls;
  return out;
}

/** 把参考图的 OSS URL 写进 params.input_urls，供作品页缩略图与「套用」使用 */
async function persistInputUrls(genId: number, urls: string[]): Promise<void> {
  if (!urls.length) return;
  const current = await db.generation
    .findUnique({ where: { id: genId }, select: { params: true } })
    .catch(() => null);
  if (!current) return;
  try {
    const params = JSON.parse(current.params) as Record<string, unknown>;
    params.input_urls = urls;
    await db.generation.update({
      where: { id: genId },
      data: { params: JSON.stringify(params) },
    });
  } catch {
    // 参数损坏不阻断生成
  }
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
