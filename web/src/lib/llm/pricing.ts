/**
 * LLM 计费的算术。纯函数，不碰数据库——因为这是全站最不能算错的一段代码，
 * 必须能被单测直接钉死。
 *
 * 为什么不能沿用生成端那套：生成端是**事前定价**，档位选定 `creditCost`
 * 就是确定的整数，扣完再跑。LLM 是**事后才知道用了多少 token**。
 * 这是结构性差异。
 *
 * 核心是微点。站内 1 点 ≈ $0.01，而一次基础档润色的真实成本约 $0.0003，
 * 乘 130% 之后是 0.039 点。按整点 ceil 的话实际收费是成本的 25 倍——
 * 标价体系立刻失真，用户点两下掉 2 点，观感极差。所以内部按千分之一点累计，
 * 满 1 点才动 balance。
 */

/** 微点 = 千分之一点 */
export const MICRO_PER_CREDIT = 1000;

/**
 * 最低收费 0.005 点。
 *
 * 防的是「输出三个字」这类调用扣成 0，等于免费无限调用大模型。
 * 定成 5 而不是更高，是为了不把基础档的价格优势抹掉——
 * 基础档一次 0.039 点，下限只占其中八分之一。
 */
export const MIN_CHARGE_MICRO = 5;

/**
 * 本次应扣多少微点。
 *
 * ```
 * micro = round(usd / USD_PER_CREDIT × 1000 × multiplierBps / 10000)
 * micro = max(micro, minChargeMicro)
 * micro = round(micro × (10000 - vipDiscountBps) / 10000)
 * ```
 *
 * 下限**在 VIP 折扣之前**生效：折扣是给会员的让利，不该被下限吃掉；
 * 反过来先打折再取下限，等于会员的折扣在小额调用上完全失效。
 */
export function chargedMicroFor(opts: {
  /** 上游本次的实际成本（美元）。拿不到真账时传本地单价算出来的估算值 */
  costUsd: number;
  /** 站内 1 点值多少美元。由调用方传入，避免这个纯函数依赖生成端的常量表 */
  usdPerCredit: number;
  /** 加价倍率，与生成端同口径 */
  multiplierBps: number;
  vipDiscountBps?: number;
  minChargeMicro?: number;
}): number {
  const { costUsd, usdPerCredit, multiplierBps } = opts;
  if (!(usdPerCredit > 0)) return 0;
  /*
   * 成本为 0 就是一分钱没花（上游根本没跑起来），这时连下限都不该收。
   * 下限管的是「花了一点点」，不是「什么都没花」。
   */
  if (!Number.isFinite(costUsd) || costUsd <= 0) return 0;

  const base = (costUsd / usdPerCredit) * MICRO_PER_CREDIT * (multiplierBps / 10000);
  let micro = Math.max(Math.round(base), opts.minChargeMicro ?? MIN_CHARGE_MICRO);
  micro = Math.round((micro * (10000 - (opts.vipDiscountBps ?? 0))) / 10000);
  return Math.max(0, micro);
}

/**
 * 把这次的微点并进零头，算出该从 balance 上扣几个整点。
 *
 * 零头**永不归零**，跨充值继续累计——归零等于每次充值都抹掉一笔
 * 已经发生的成本。
 */
export function settleDebt(
  debtMicro: number,
  chargedMicro: number
): { credits: number; restMicro: number } {
  const total = Math.max(0, debtMicro | 0) + Math.max(0, chargedMicro | 0);
  return {
    credits: Math.floor(total / MICRO_PER_CREDIT),
    restMicro: total % MICRO_PER_CREDIT,
  };
}

/** 美元 → μ$。整数入库：这张表存在的意义就是对账，浮点求和会飘 */
export function usdToMicro(usd: number): number {
  return Math.round(Math.max(0, usd) * 1_000_000);
}

export function microToUsd(micro: number): number {
  return micro / 1_000_000;
}

/** 微点 → 给人看的点数，去掉无意义的尾零 */
export function formatMicroCredits(micro: number): string {
  return (micro / MICRO_PER_CREDIT).toFixed(3).replace(/\.?0+$/, "");
}
