import { NextResponse } from "next/server";
import { z } from "zod";
import { GENERATION_MODES, GENERATION_TIERS } from "@/lib/generation-modes";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { acquireUserLock } from "@/lib/user-lock";
import {
  CONTEXT_CHARS,
  newRewriteProgress,
  rewriteSelection,
  streamRewriteSelection,
  type RewriteInput,
  type RewriteOutput,
  type RewriteProgress,
} from "@/lib/prompt-rewrite";
import { LLM_TIMEOUT_MS, type ChatUsage } from "@/lib/llm/chat";
import { estimateCostUsd, type LlmModelSpec } from "@/lib/llm/models";
import { formatMicroCredits } from "@/lib/llm/pricing";
import {
  recordLlmUsage,
  vipDiscountBpsOf,
  type LlmUsageResult,
  type LlmUsageStatus,
} from "@/lib/llm/billing";
import { estimateTokens } from "@/lib/ai-token-cost";
import { isBlocked, reviewPrompt } from "@/lib/content-safety";
import { hasAdultAccess } from "@/lib/adult-access";

const bodySchema = z.object({
  action: z.enum(["polish", "localize", "expand", "shorten", "emphasize"]),
  selection: z.string().min(1).max(2000),
  context_before: z.string().max(CONTEXT_CHARS).default(""),
  context_after: z.string().max(CONTEXT_CHARS).default(""),
  mode: z.enum(GENERATION_MODES).optional(),
  tier: z.enum(GENERATION_TIERS).optional(),
  spicy: z.boolean().optional(),
  target_chars: z.number().int().min(10).max(2000).optional(),
  /** 要流式就置 true。不支持流式的环境照旧拿 JSON */
  stream: z.boolean().optional(),
});

/** 锁的兜底时长：够一次硬超时跑完，再留一点收尾时间 */
const LOCK_TTL_MS = LLM_TIMEOUT_MS + 10_000;

/** 这一期只有选区级一个时机；S4 才有 block / slash / empty / submit */
const TRIGGER = "selection";

type Failure = { error: string; code?: string; status: number; level?: string };

/**
 * 选区级 AI：只改用户选中的那一段。
 *
 * 与魔法指令的关键差别是**审查对象**：这里审的是「替换之后的全文」，
 * 不是模型回的那个片段。片段脱离上下文两个方向都会误判——
 * 整段里越线的话孤立看无害，孤立看越线的话放回整段可能完全正常。
 *
 * 扣费口径只有一条判据：**上游跑了没有**。跑了就收，哪怕结果被审查拦下来、
 * 哪怕用户中途取消——钱已经花出去了。没跑一律不收。
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  /*
   * 限流比魔法指令宽：选区级动作天然就是高频的，选中一句润色一下就是一次。
   * 真正的成本闸门是按 token 扣点，不是次数——次数限制在这里只用来
   * 挡住脚本化的滥用。
   */
  if (!rateLimit(`prompt-rewrite:${user.id}`, 60, 60_000)) {
    return NextResponse.json({ error: "请求过于频繁，请稍后再试" }, { status: 429 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "参数无效" },
      { status: 400 }
    );
  }
  const input = parsed.data;

  if (input.mode === "undress") {
    return NextResponse.json({ error: "该模式不支持提示词改写" }, { status: 400 });
  }

  /*
   * 发起新调用要求余额 > 0（规划 6.2b）。等于 0 就是没钱了，拦在入口。
   * 但**已经跑起来的调用一律结算到底**，哪怕把余额打成负数——
   * 所以这里判的是「大于 0」而不是「够不够这次花」：够不够根本没法事先知道。
   */
  if (user.balance <= 0) {
    return NextResponse.json(
      { error: "点数不足，请先充值", code: "INSUFFICIENT_CREDITS" },
      { status: 400 }
    );
  }

  /*
   * 用户级互斥（规划 6.5）。前端已经规定「同一时刻只允许一个 AI 动作」，
   * 但那条规则挡不住脚本：先校验余额、后按真实用量扣费，中间那段窗口
   * 可以并发发起多次调用来透支。闸门必须在服务端也有一道。
   */
  const release = acquireUserLock(`ai:${user.id}`, LOCK_TTL_MS);
  if (!release) {
    return NextResponse.json(
      { error: "上一个 AI 动作还在跑，请等它结束", code: "AI_BUSY" },
      { status: 429 }
    );
  }

  const adultAccess = hasAdultAccess(user);
  const vipDiscountBps = vipDiscountBpsOf(user);
  /** 把片段放回原位，得到「用户实际会看到的整段文本」 */
  const assemble = (fragment: string) =>
    `${input.context_before}${fragment}${input.context_after}`;
  const mode = input.mode ?? "txt2img";

  const rewriteInput: RewriteInput = {
    action: input.action,
    selection: input.selection,
    contextBefore: input.context_before,
    contextAfter: input.context_after,
    mode,
    tier: input.tier,
    spicy: input.spicy,
    allowSensitive: adultAccess,
    targetChars: input.target_chars,
  };

  /** 审查一次「替换之后的整段」。返回 null 表示通过 */
  const review = async (fragment: string): Promise<Failure | null> => {
    const safety = await reviewPrompt({ mode, prompt: assemble(fragment) });
    if (!isBlocked(safety, adultAccess)) return null;
    return {
      error: `内容审查未通过：${safety.reason}`,
      code: "CONTENT_POLICY_REJECTED",
      level: safety.level,
      status: 422,
    };
  };

  const bill = (args: {
    status: LlmUsageStatus;
    model: LlmModelSpec;
    usage: ChatUsage;
    promptText: string;
    outputText: string;
  }) => {
    const measured = usageOrEstimate(args.usage, args.model, args.promptText, args.outputText);
    return recordLlmUsage({
      userId: user.id,
      skillKey: input.action,
      modelKey: args.model.key,
      trigger: TRIGGER,
      multiplierBps: args.model.priceMultiplierBps,
      vipDiscountBps,
      status: args.status,
      // 走到这里说明上游已经产出过内容，钱已经花了
      charge: true,
      ...measured,
    });
  };

  try {
    // 入口审查同样按整段判，理由与出口一致。被这里拦下时上游一次都没调，不收钱
    const inputBlocked = await review(input.selection);
    if (inputBlocked) {
      release();
      return fail(inputBlocked);
    }

    if (!input.stream) {
      const progress = newRewriteProgress();
      try {
        const result = await rewriteSelection(rewriteInput, { progress });
        if (!result) return fail(UNAVAILABLE);

        const outputBlocked = await review(result.text);
        const settled = await bill({
          status: outputBlocked ? "blocked" : "ok",
          model: result.model,
          usage: result.usage ?? {},
          promptText: progress.promptText,
          outputText: result.text,
        });
        // 拦截也扣费：上游已经跑过了，成本已经发生
        if (outputBlocked) return fail({ ...outputBlocked, ...chargeFields(settled) });

        return NextResponse.json({
          ok: true,
          /** 只回改写后的片段，替换由前端在原选区上做 */
          text: result.text,
          dropped_refs: result.droppedRefs,
          ...chargeFields(settled),
        });
      } finally {
        release();
      }
    }

    return streamResponse({ req, rewriteInput, review, bill, release, logUser: user.id });
  } catch (err) {
    release();
    console.error("[prompt-rewrite]", err);
    return NextResponse.json({ error: "改写失败，请稍后重试" }, { status: 400 });
  }
}

const UNAVAILABLE: Failure = {
  error: "改写未启用或上游无响应，请稍后重试",
  code: "REWRITE_UNAVAILABLE",
  status: 503,
};

function fail(f: Failure & Partial<ReturnType<typeof chargeFields>>) {
  const { error, code, level, status, ...rest } = f;
  return NextResponse.json(
    { error, ...(code ? { code } : {}), ...(level ? { level } : {}), ...rest },
    { status }
  );
}

/**
 * 回给前端的花费。三个数缺一不可：
 * 单次消耗要显示出来（否则用户以为免费），零头要显示出来（否则某次突然掉
 * 1 点会来投诉），真正扣掉的整点要显示出来（余额变了得有个交代）。
 */
function chargeFields(settled: LlmUsageResult) {
  return {
    charged_micro: settled.chargedMicro,
    charged_credits: formatMicroCredits(settled.chargedMicro),
    settled_credits: settled.settledCredits,
    debt_micro: settled.debtMicro,
    debt_credits: formatMicroCredits(settled.debtMicro),
  };
}

/**
 * 拿上游的真账，拿不到就按本地单价估。
 *
 * **查不到成本绝不能变成「这次不扣费」**——上游的钱已经花了。
 * 估算值一律标记出来，否则日后对账分不清哪一笔是估的。
 */
function usageOrEstimate(
  usage: ChatUsage,
  model: LlmModelSpec,
  promptText: string,
  outputText: string
): { promptTokens: number; completionTokens: number; costUsd: number; costEstimated: boolean } {
  const promptTokens = usage.promptTokens ?? estimateTokens(promptText);
  const completionTokens = usage.completionTokens ?? estimateTokens(outputText);
  if (usage.costUsd != null) {
    return {
      promptTokens,
      completionTokens,
      costUsd: usage.costUsd,
      costEstimated: usage.costEstimated ?? false,
    };
  }
  return {
    promptTokens,
    completionTokens,
    costUsd: estimateCostUsd(model, promptTokens, completionTokens),
    costEstimated: true,
  };
}

/**
 * SSE 响应。
 *
 * 边流边显示，但**替换按钮要等 done**：出口审查只有拿到全文才能做，
 * 在那之前流出来的文字还没被判过。让用户提前按下去，等于把一段没过审的
 * 文本放进正文。
 */
function streamResponse(args: {
  req: Request;
  rewriteInput: RewriteInput;
  review(fragment: string): Promise<Failure | null>;
  bill(a: {
    status: LlmUsageStatus;
    model: LlmModelSpec;
    usage: ChatUsage;
    promptText: string;
    outputText: string;
  }): Promise<LlmUsageResult>;
  release(): void;
  logUser: number;
}) {
  const { req, rewriteInput, review, bill, release, logUser } = args;
  const encoder = new TextEncoder();
  const progress: RewriteProgress = newRewriteProgress();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (payload: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      try {
        let result: RewriteOutput | null = null;
        for await (const ev of streamRewriteSelection(rewriteInput, {
          signal: req.signal,
          progress,
        })) {
          if (ev.type === "delta") send({ type: "delta", text: ev.text });
          else result = ev.result;
        }

        if (!result) {
          // 上游连一个字都没给：没跑起来，不收钱
          send({ type: "error", ...UNAVAILABLE });
          return;
        }

        const blocked = await review(result.text);
        const settled = await bill({
          status: blocked ? "blocked" : "ok",
          model: result.model,
          usage: result.usage ?? {},
          promptText: progress.promptText,
          outputText: result.text,
        });

        if (blocked) {
          send({ type: "error", ...blocked, ...chargeFields(settled) });
          return;
        }

        send({
          type: "done",
          text: result.text,
          dropped_refs: result.droppedRefs,
          ...chargeFields(settled),
        });
      } catch (err) {
        /*
         * 客户端断开、用户点取消、硬超时，最后都是从这里出去的。
         * 只要上游已经吐过字，这笔就得结账——不然「点了就取消」是一个
         * 免费无限调用大模型的口子。
         */
        const canceled = req.signal.aborted;
        if (progress.raw && progress.model) {
          await bill({
            status: canceled ? "canceled" : "timeout",
            model: progress.model,
            usage: progress.usage,
            promptText: progress.promptText,
            outputText: progress.raw,
          }).catch((e) => console.error("[prompt-rewrite:bill]", e));
        } else if (!canceled) {
          console.error("[prompt-rewrite:stream]", err);
          await logFailure(logUser, progress);
        }
        if (!canceled) send({ type: "error", error: "改写失败，请稍后重试", status: 400 });
      } finally {
        release();
        closed = true;
        try {
          controller.close();
        } catch {
          // 客户端已经断开，close 会抛。这不是错误
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      /* 反代默认会缓冲响应，缓冲了就没有「流式」可言了 */
      "X-Accel-Buffering": "no",
    },
  });
}

/** 一个字都没产出的失败也要落台账：报表里「失败率」比「花了多少」更早示警 */
async function logFailure(userId: number, progress: RewriteProgress) {
  if (!progress.model) return;
  await recordLlmUsage({
    userId,
    skillKey: "unknown",
    modelKey: progress.model.key,
    trigger: TRIGGER,
    promptTokens: 0,
    completionTokens: 0,
    costUsd: 0,
    costEstimated: false,
    multiplierBps: progress.model.priceMultiplierBps,
    vipDiscountBps: 0,
    status: "failed",
    charge: false,
  }).catch((e) => console.error("[prompt-rewrite:log]", e));
}
