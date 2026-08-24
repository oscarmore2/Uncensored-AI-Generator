import { NextResponse } from "next/server";
import { z } from "zod";
import { GENERATION_MODES, GENERATION_TIERS } from "@/lib/generation-modes";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { acquireUserLock } from "@/lib/user-lock";
import {
  CONTEXT_CHARS,
  rewriteSelection,
  streamRewriteSelection,
  type RewriteInput,
  type RewriteOutput,
} from "@/lib/prompt-rewrite";
import { LLM_TIMEOUT_MS } from "@/lib/llm/chat";
import { LLM_MODELS, pickTier } from "@/lib/llm/models";
import { getAiCreditsPer1kTokens } from "@/lib/ai-token-billing";
import { creditsForTokens, estimateTokens } from "@/lib/ai-token-cost";
import { db } from "@/lib/db";
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

type Failure = { error: string; code?: string; status: number; level?: string };

/**
 * 选区级 AI：只改用户选中的那一段。
 *
 * 与魔法指令的关键差别是**审查对象**：这里审的是「替换之后的全文」，
 * 不是模型回的那个片段。片段脱离上下文两个方向都会误判——
 * 整段里越线的话孤立看无害，孤立看越线的话放回整段可能完全正常。
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

  /**
   * 扣点。与魔法指令同一套规则：审查通过之后才收钱——
   * 被我们拒绝的结果不该让用户买单。
   */
  const settle = async (result: RewriteOutput): Promise<{ charged: number } | Failure> => {
    const per1k = await getAiCreditsPer1kTokens();
    const tokens = result.tokens ?? estimateTokens(input.selection + result.text);
    const charged = creditsForTokens(tokens, per1k);
    if (charged > 0) {
      const ok = await db.user.updateMany({
        where: { id: user.id, balance: { gte: charged } },
        data: { balance: { decrement: charged } },
      });
      if (ok.count === 0) {
        return { error: "点数不足，请先充值", code: "INSUFFICIENT_CREDITS", status: 400 };
      }
    }
    logCost(user.id, rewriteInput, result, tokens, charged);
    return { charged };
  };

  try {
    // 入口审查同样按整段判，理由与出口一致
    const inputBlocked = await review(input.selection);
    if (inputBlocked) {
      release();
      return fail(inputBlocked);
    }

    if (!input.stream) {
      try {
        const result = await rewriteSelection(rewriteInput);
        if (!result) return fail(UNAVAILABLE);

        const outputBlocked = await review(result.text);
        if (outputBlocked) return fail(outputBlocked);

        const settled = await settle(result);
        if ("error" in settled) return fail(settled);

        return NextResponse.json({
          ok: true,
          /** 只回改写后的片段，替换由前端在原选区上做 */
          text: result.text,
          charged: settled.charged,
          dropped_refs: result.droppedRefs,
        });
      } finally {
        release();
      }
    }

    return streamResponse({ req, rewriteInput, review, settle, release });
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

function fail(f: Failure) {
  return NextResponse.json(
    { error: f.error, ...(f.code ? { code: f.code } : {}), ...(f.level ? { level: f.level } : {}) },
    { status: f.status }
  );
}

/**
 * 成本可见性。S1 才有 `LlmUsageLog` 报表，但 S0 一上线就在花钱——
 * 在那之前至少让服务端日志能回答「这次花了多少、收了多少」。
 */
function logCost(
  userId: number,
  input: RewriteInput,
  result: RewriteOutput,
  tokens: number,
  charged: number
) {
  const tier = pickTier({ allowSensitive: input.allowSensitive });
  const usd = result.usage?.costUsd;
  const cost =
    usd == null ? "cost=?" : `cost=$${usd.toFixed(6)}${result.usage?.costEstimated ? "(est)" : ""}`;
  console.info(
    `[prompt-rewrite] user=${userId} action=${input.action} model=${LLM_MODELS[tier].key} ` +
      `tokens=${tokens} ${cost} charged=${charged}`
  );
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
  settle(result: RewriteOutput): Promise<{ charged: number } | Failure>;
  release(): void;
}) {
  const { req, rewriteInput, review, settle, release } = args;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (payload: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      try {
        let result: RewriteOutput | null = null;
        for await (const ev of streamRewriteSelection(rewriteInput, req.signal)) {
          if (ev.type === "delta") send({ type: "delta", text: ev.text });
          else result = ev.result;
        }

        /*
         * 客户端断开（用户点了取消 / 关了页面）就到此为止。
         * 上游的 token 已经花掉了，但我们既拿不到用量也没有结果可交付，
         * S0 这一版按「不扣」处理——S1 有了 LlmUsageLog 才补得上这笔账。
         */
        if (req.signal.aborted) return;

        if (!result) {
          send({ type: "error", ...UNAVAILABLE });
          return;
        }

        const blocked = await review(result.text);
        if (blocked) {
          send({ type: "error", ...blocked });
          return;
        }

        const settled = await settle(result);
        if ("error" in settled) {
          send({ type: "error", ...settled });
          return;
        }

        send({
          type: "done",
          text: result.text,
          charged: settled.charged,
          dropped_refs: result.droppedRefs,
        });
      } catch (err) {
        if (!req.signal.aborted) {
          console.error("[prompt-rewrite:stream]", err);
          send({ type: "error", error: "改写失败，请稍后重试", status: 400 });
        }
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
