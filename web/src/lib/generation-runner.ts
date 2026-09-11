import "server-only";
import { randomUUID } from "crypto";
import { db } from "./db";
import {
  failAndRefund,
  markTimeout,
  recordSafetyBlock,
  settleSuccess,
} from "./generation-settle";
import { env } from "./env";
import { sendTelegram } from "./telegram";
import { ossConfigured, uploadBufferWithMeta } from "./oss";
import {
  anyProviderConfigured,
  estimateUnitPrice,
  getAdapter,
  mapProviderStatus,
  PROVIDER_META,
  toProviderId,
} from "./providers";
import { buildProviderInputs, inputsForPricing, parseRequestSchema } from "./generation-bridge";
import { pickRefSyntax, renderPromptRefs } from "./model-ref-syntax";
import { modeNeedsMedia } from "./generation-modes";
import { isAdultContent, reviewImages } from "./content-safety";
import {
  applySourceAspectToInputs,
  readImageDimsFromDataUrl,
} from "./undress-geometry";
import { sanitizeFilename } from "./media-delete-reason";
import { createMediaAssetCompat } from "./media-asset-compat";
import { contentAddressedPath, findReusableUpload, sha256OfBuffer } from "./media-dedup";
import { uploadMediaExpiryForUser } from "./media-retention";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 这一轮最多守多久。
 *
 * 以前是「90 次 × 固定间隔」≈ 6.4 分钟，视频类任务经常不够，超时就被判成失败
 * 并退款——而上游那边还在跑，后来真出片了也没人把记录改回来。
 *
 * 现在放宽到 20 分钟，而且**超了也只标超时不判失败**，真结论交给重查
 * （generation-recheck.ts）。所以这个数字不再是「对不对」的问题，
 * 只是「守多久算划算」——守着能让用户当场看到结果，守不到也不会写错记录。
 */
const POLL_BUDGET_MS = 20 * 60_000;

/**
 * 轮询间隔逐级放宽。
 *
 * 图片通常几十秒内就出，前十次密一点能让进度条跟手；长任务每 5 秒问一次
 * 纯属浪费上游配额，20 分钟能问出两百多次。
 */
function pollDelay(i: number): number {
  if (i < 10) return 2_500;
  if (i < 40) return 5_000;
  return 15_000;
}

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
  const sha256 = sha256OfBuffer(buffer);

  // 与 api/uploads 同一套：内容寻址 + 命中就复用，这条路径重复率最高
  // （同一张参考图换档位重跑、多次重试，每次都会再走一遍这里）
  const reuse = await findReusableUpload(sha256);
  const uploaded =
    reuse ??
    (await uploadBufferWithMeta(buffer, contentAddressedPath(sha256, ext), contentType));

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
      sha256,
      sourceId: genId,
      retentionAssigned: true,
      expiresAt: await uploadMediaExpiryForUser(userId),
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

    const [catalogModel, mappings, refRules] = await Promise.all([
      db.providerCatalogModel.findUnique({
        where: { provider_modelId: { provider, modelId: product.providerModelId } },
        select: { apiSchema: true, type: true },
      }),
      db.modeParamMapping.findMany({
        where: { mode: gen.mode, enabled: true },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      }),
      db.modelRefSyntax.findMany({
        where: { enabled: true },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: {
          matchModelId: true,
          provider: true,
          imageFormat: true,
          videoFormat: true,
          audioFormat: true,
        },
      }),
    ]);

    /*
     * 媒体引用改写。库里存的一直是规范形式（@Image1），只有交给上游的
     * 这一份按目标模型改写——换模型重跑同一条提示词才不用改文案。
     * 匹配不到规则就原样透传。
     */
    const refRule = pickRefSyntax(refRules, provider, product.providerModelId);
    const outboundPrompt = renderPromptRefs(gen.prompt, refRule);
    if (outboundPrompt !== gen.prompt) {
      console.info(
        `[generation] ${genId} 引用改写 ${product.providerModelId}：` +
          `${JSON.stringify(gen.prompt.slice(0, 60))} → ${JSON.stringify(outboundPrompt.slice(0, 60))}`
      );
    }

    const { inputs, snapped } = buildProviderInputs({
      product,
      apiSchema: catalogModel?.apiSchema ?? null,
      prompt: outboundPrompt,
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

    const startedAt = Date.now();
    for (let i = 0; Date.now() - startedAt < POLL_BUDGET_MS; i++) {
      await sleep(pollDelay(i));
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
      // 拿不到实时单价（Atlas 没有这个接口）时留空，成本看板会退回目录基准价
      const costUsd = await estimateUnitPrice(
        provider,
        product.providerModelId,
        inputsForPricing(inputs, catalogModel?.apiSchema ?? null)
      ).catch(() => null);
      await settleSuccess({
        genId,
        outputs,
        thumbnails,
        costUsd,
        inputUrls: imageUrl ? [imageUrl] : [],
      });
    } else if (mapped === "failed") {
      // 上游给了明确的失败结论，这才是真失败
      await failAndRefund(genId, lastError || "上游返回失败");
    } else {
      /*
       * 预算用完但上游还没给结论。**不判失败、不退款**——判了之后它成功了
       * 也没人改回来，用户看到的会是一条永久错的「失败」。
       * 打开历史记录时会回上游重新确认。
       */
      await markTimeout(genId, lastError);
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
