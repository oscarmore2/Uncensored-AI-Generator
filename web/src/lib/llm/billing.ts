import "server-only";
import { db } from "../db";
import { ZC_STARTER_USD_PER_CREDIT } from "../generation-catalog";
import { isVipActive } from "../pricing";
import { chargedMicroFor, settleDebt, usdToMicro } from "./pricing";

/**
 * LLM 的落账：算钱、扣钱、记一笔用量。
 *
 * 与生成端共用同一个 USD/点锚点。不共用的话，同样 10 点买到的东西
 * 在两条业务线上会差两个数量级。
 */
export const USD_PER_CREDIT = ZC_STARTER_USD_PER_CREDIT;

/**
 * `canceled` 不在规划原来那份 `ok | blocked | failed | timeout` 里，是实现时加的。
 * 「用户自己中途取消」和「上游炸了」对成本分析是完全不同的两件事：
 * 前者说明结果来得太慢或不合用，后者是故障。混在 failed 里报表就白做了。
 */
export type LlmUsageStatus = "ok" | "blocked" | "canceled" | "failed" | "timeout";

export type LlmUsageInput = {
  userId: number;
  /** S0/S1 是硬编码动作名，S2 起是 Skill.key */
  skillKey: string;
  modelKey: string;
  trigger: string;
  promptTokens: number;
  completionTokens: number;
  /** 上游本次实际成本；拿不到真账时传本地估算值并把 costEstimated 置 true */
  costUsd: number;
  costEstimated: boolean;
  multiplierBps: number;
  vipDiscountBps: number;
  status: LlmUsageStatus;
  /**
   * 要不要收钱。**判据只有一条：上游跑了没有。**
   *
   * 跑了就收——被内容审查拦下来、被用户取消，钱都已经花出去了，
   * 这一条必须写进用户可见的文案，否则被拦的用户会觉得是白扣。
   * 没跑（凭据缺失、连接就失败）一律不收。
   */
  charge: boolean;
};

export type LlmUsageResult = {
  chargedMicro: number;
  /** 本次真正从 balance 上扣掉的整点。攒不满 1 点时是 0 */
  settledCredits: number;
  /** 结算后剩下的零头 */
  debtMicro: number;
};

export async function recordLlmUsage(input: LlmUsageInput): Promise<LlmUsageResult> {
  const chargedMicro = input.charge
    ? chargedMicroFor({
        costUsd: input.costUsd,
        usdPerCredit: USD_PER_CREDIT,
        multiplierBps: input.multiplierBps,
        vipDiscountBps: input.vipDiscountBps,
      })
    : 0;

  const settled = await settleMicro(input.userId, chargedMicro);

  /*
   * 落台账。这里刻意不抛：账记不上是运营问题，把用户的改写结果一起弄丢
   * 才是事故。失败时留一条 error 日志，值班的人能看见。
   */
  try {
    await db.llmUsageLog.create({
      data: {
        userId: input.userId,
        skillKey: input.skillKey,
        modelKey: input.modelKey,
        trigger: input.trigger,
        promptTokens: Math.max(0, Math.round(input.promptTokens)),
        completionTokens: Math.max(0, Math.round(input.completionTokens)),
        costUsdMicro: usdToMicro(input.costUsd),
        costEstimated: input.costEstimated,
        chargedMicro,
        settledCredits: settled.settledCredits,
        status: input.status,
      },
    });
  } catch (err) {
    console.error("[llm-billing] usage log failed:", err);
  }

  return { chargedMicro, ...settled };
}

/**
 * 把微点并进零头，满 1000 才动 balance。
 *
 * 用「读一次 + 带旧值的条件更新」做乐观并发，而不是读完直接写：
 * 两个请求同时读到同一个零头再各自写回，后写的那个会把前一个的账吞掉。
 * 上层虽然有用户级互斥，但那把锁是进程内的，多副本时不成立。
 */
async function settleMicro(
  userId: number,
  micro: number
): Promise<{ settledCredits: number; debtMicro: number }> {
  if (micro <= 0) {
    const row = await db.user.findUnique({ where: { id: userId }, select: { aiDebtMicro: true } });
    return { settledCredits: 0, debtMicro: row?.aiDebtMicro ?? 0 };
  }

  for (let attempt = 0; attempt < 4; attempt++) {
    const row = await db.user.findUnique({ where: { id: userId }, select: { aiDebtMicro: true } });
    if (!row) return { settledCredits: 0, debtMicro: 0 };

    const { credits, restMicro } = settleDebt(row.aiDebtMicro, micro);
    const ok = await db.user.updateMany({
      where: { id: userId, aiDebtMicro: row.aiDebtMicro },
      data: {
        aiDebtMicro: restMicro,
        /*
         * 不加 `balance >= credits` 的条件：**已经跑起来的调用一律结算到底**，
         * 哪怕把余额打成负数——上游的钱已经花了。透支额度天然有界
         * （maxOutputTokens 硬顶 + 同时只允许一个 AI 动作），最大负值
         * 就是一次调用的成本。生成端不受影响：它自己那道
         * `balance >= cost` 校验在负余额下自动为假，照旧拦住。
         */
        ...(credits > 0 ? { balance: { decrement: credits } } : {}),
      },
    });
    if (ok.count !== 1) continue;

    if (credits > 0) {
      try {
        await db.transaction.create({
          data: { userId, type: "ai_skill", amount: -credits },
        });
      } catch (err) {
        console.error("[llm-billing] transaction row failed:", err);
      }
    }
    return { settledCredits: credits, debtMicro: restMicro };
  }

  // 抢了四次都没抢到。宁可漏收这一笔，也不能在这里死循环拖住用户的请求
  console.error(`[llm-billing] settle contention, dropped ${micro}μ for user ${userId}`);
  return { settledCredits: 0, debtMicro: 0 };
}

/** 当前用户能享受的折扣。VIP 过期就是 0，与生成端同一条判定 */
export function vipDiscountBpsOf(
  user: Parameters<typeof isVipActive>[0] & { vipTier?: { discountBps: number } | null }
): number {
  if (!isVipActive(user)) return 0;
  return user?.vipTier?.discountBps ?? 0;
}
