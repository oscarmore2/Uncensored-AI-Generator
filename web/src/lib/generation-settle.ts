import "server-only";
import { db } from "./db";
import { isAdultContent, reviewImages, safetyAudit } from "./content-safety";
import { mirrorRemoteUrls } from "./oss";
import { sendTelegram } from "./telegram";

/**
 * 生成任务的终局落地：成功、失败、超时。
 *
 * 单独一个模块，是因为这三件事现在有**两个入口**——提交时那条轮询（runner），
 * 以及事后回上游确认的重查（recheck）。两边各写一份的话，迟早有一处忘了
 * 出口审查或者忘了镜像 URL，症状是「有的任务出片能看，有的过两天全裂」。
 */

/**
 * 还没有终局的状态。这些行随时可能被重查接手。
 *
 * `timeout` 是这一版新加的：以前轮询跑完就直接判 failed 并退款，可上游那边
 * 任务往往还在跑，后来真出片了也没人把记录改回来——用户看到的是一条永久错的
 * 「失败」。现在超时只是「我们暂时不知道」，**不是结论，也不退款**。
 */
export const OPEN_STATUSES = ["pending", "queued", "processing", "timeout"] as const;

/** 成功收尾时要落库的参数：原样保留用户可复现的选择，只丢掉大体积的 base64。 */
export function reproducibleParams(
  params: Record<string, unknown>,
  extra: {
    tier: string;
    spicy: boolean;
    productId: number | null;
    inputUrls: string[];
    thumbUrls: string[];
  }
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...params };
  delete out.image_base64;
  out.tier = extra.tier;
  out.spicy = extra.spicy;
  if (extra.productId != null) out.product_id = extra.productId;
  if (extra.inputUrls.length) out.input_urls = extra.inputUrls;
  if (extra.thumbUrls.length) out.result_thumb_urls = extra.thumbUrls;
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

function safeParams(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * 上游说成功了，把结果落地。
 *
 * 返回 `blocked` 表示结果被出口审查拦下（已按失败退款），`gone` 表示这条记录
 * 已经被别人收尾了——重查是可以并发触发的（两个标签页同时打开历史记录），
 * 不抢占的话会镜像两遍、也可能把同一条记录改两次。
 */
export async function settleSuccess(opts: {
  genId: number;
  outputs: string[];
  thumbnails: string[];
  /** 拿不到实时单价（Atlas 没有这个接口）时留空，成本看板会退回目录基准价 */
  costUsd?: number | null;
  /** 本次新落地的参考图；重查路径传空，params 里原有的 input_urls 照旧保留 */
  inputUrls?: string[];
}): Promise<"succeeded" | "blocked" | "gone"> {
  const { genId, outputs, thumbnails } = opts;

  /*
   * 先抢占再干活。抢的是「还没成功」这个条件，抢到了才继续——
   * 否则两个重查会各自跑一遍出口审查和镜像，白花钱还可能写花记录。
   */
  const claimed = await db.generation.updateMany({
    where: { id: genId, status: { notIn: ["succeeded", "failed"] } },
    data: { status: "processing", progress: 99 },
  });
  if (claimed.count === 0) return "gone";

  const gen = await db.generation.findUnique({ where: { id: genId } });
  if (!gen) return "gone";

  // 结果落库前先过闸：模型可能产出提示词里没有的内容，
  // 这是纯提示词审查抓不到的一层，也是 CSAM 的最后一道防线
  const outSafety = await reviewImages({ urls: outputs, prompt: gen.prompt });
  if (outSafety.level === "prohibited") {
    await recordSafetyBlock(genId, gen.userId, "生成结果", outSafety);
    await failAndRefund(genId, `生成结果内容审查未通过：${outSafety.reason}`);
    return "blocked";
  }

  const finalUrls = await mirrorRemoteUrls(outputs, `generations/${genId}`);

  await db.generation.update({
    where: { id: genId },
    data: {
      status: "succeeded",
      progress: 100,
      providerError: null,
      resultUrls: JSON.stringify(finalUrls.length ? finalUrls : outputs),
      isAdult: gen.isAdult || isAdultContent(outSafety),
      safetyCategories: JSON.stringify(
        Array.from(new Set([...safeCategories(gen.safetyCategories), ...safetyAudit(outSafety)]))
      ),
      ...(opts.costUsd != null ? { providerCostUsd: opts.costUsd } : {}),
      // 清掉大体积 base64，其余原样留着：
      // 「套用」要靠它复原 gender / undress_options / 模型额外参数，
      // input_urls 则是参考图被 base64 清掉后唯一的线索
      params: JSON.stringify(
        reproducibleParams(safeParams(gen.params), {
          tier: gen.tier,
          spicy: gen.spicy,
          productId: gen.productId,
          inputUrls: opts.inputUrls ?? [],
          thumbUrls: thumbnails,
        })
      ),
    },
  });
  return "succeeded";
}

/**
 * 轮询预算用完了，但上游还没给结论。
 *
 * **不退款、不判失败**：任务多半还在上游跑着，判了失败之后它成功了也没人改回来。
 * 打开历史记录时会回上游重新确认（见 generation-recheck.ts），
 * 拿到真结论才落终局。
 */
export async function markTimeout(genId: number, note?: string): Promise<void> {
  await db.generation.updateMany({
    where: { id: genId, status: { notIn: ["succeeded", "failed"] } },
    data: {
      status: "timeout",
      providerError: (note ?? "上游尚未返回结果，稍后会自动重新确认").slice(0, 500),
    },
  });
}

export async function failAndRefund(genId: number, reason?: string) {
  // 原子抢占：只有第一个把状态转为 failed 的调用会往下走
  const claimed = await db.generation.updateMany({
    where: { id: genId, status: { not: "failed" } },
    data: { status: "failed", providerError: reason?.slice(0, 500) },
  });
  if (claimed.count === 0) return;

  const gen = await db.generation.findUnique({ where: { id: genId } });
  if (!gen) return;

  /*
   * 退款要按「这条记录退过没有」去重，不能只靠上面那次状态抢占。
   *
   * 状态抢占的前提是「一旦 failed 就永远 failed」，而这个前提已经不成立了：
   * 被超时误判过的旧记录会被翻回 timeout 再走一遍收尾
   * （scripts/recover-timeout-generations.mjs），那时状态抢占会放行，
   * 于是同一个任务退两次款。
   */
  const params = safeParams(gen.params);
  if (params.refunded_at) return;

  await db.$transaction([
    db.user.update({ where: { id: gen.userId }, data: { balance: { increment: gen.cost } } }),
    db.transaction.create({ data: { userId: gen.userId, type: "refund", amount: gen.cost } }),
    db.generation.update({
      where: { id: genId },
      data: { params: JSON.stringify({ ...params, refunded_at: new Date().toISOString() }) },
    }),
  ]);
  sendTelegram(
    `⚠️ 生成失败已退款\n任务 #${genId} (${gen.mode} / ${gen.tier}${gen.spicy ? " spicy" : ""})\n用户 ID: ${gen.userId}\n退回点数: ${gen.cost}${
      reason ? `\n原因: ${reason.slice(0, 120)}` : ""
    }`
  );
}

/**
 * 图像审查判定为绝对红线时留痕并告警。
 * 这类命中极少但性质严重，必须让管理员当场看到、能立刻处置账号。
 */
export async function recordSafetyBlock(
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
