import { describe, it, expect } from "vitest";
import {
  MIN_CHARGE_MICRO,
  chargedMicroFor,
  formatMicroCredits,
  settleDebt,
  usdToMicro,
} from "./pricing";

/** 站内 1 点 ≈ $0.009995（ZC Starter 口径） */
const USD_PER_CREDIT = 19.99 / 200 / 10;

describe("单次应扣微点", () => {
  it("规划 6.4 里那笔账要对得上：基础档一次约 0.039 点", () => {
    const micro = chargedMicroFor({
      costUsd: 0.0003,
      usdPerCredit: USD_PER_CREDIT,
      multiplierBps: 13000,
    });
    expect(micro).toBe(39);
    expect(formatMicroCredits(micro)).toBe("0.039");
  });

  it("无限制档按 150% 加价", () => {
    const normal = chargedMicroFor({ costUsd: 0.001, usdPerCredit: USD_PER_CREDIT, multiplierBps: 13000 });
    const spicy = chargedMicroFor({ costUsd: 0.001, usdPerCredit: USD_PER_CREDIT, multiplierBps: 15000 });
    expect(spicy / normal).toBeCloseTo(15000 / 13000, 2);
  });

  it("极小额兜到下限，不会算成 0", () => {
    // 输出三个字这种调用，不设下限就是免费无限调用大模型
    const micro = chargedMicroFor({
      costUsd: 0.0000001,
      usdPerCredit: USD_PER_CREDIT,
      multiplierBps: 13000,
    });
    expect(micro).toBe(MIN_CHARGE_MICRO);
  });

  it("成本为 0 时连下限都不收——那是上游根本没跑", () => {
    expect(chargedMicroFor({ costUsd: 0, usdPerCredit: USD_PER_CREDIT, multiplierBps: 13000 })).toBe(0);
    expect(chargedMicroFor({ costUsd: -1, usdPerCredit: USD_PER_CREDIT, multiplierBps: 13000 })).toBe(0);
    expect(chargedMicroFor({ costUsd: NaN, usdPerCredit: USD_PER_CREDIT, multiplierBps: 13000 })).toBe(0);
  });

  it("VIP 折扣在下限之后生效，小额调用上折扣也算数", () => {
    const tiny = { costUsd: 0.0000001, usdPerCredit: USD_PER_CREDIT, multiplierBps: 13000 };
    /*
     * 这笔调用本身远低于下限，被兜到 5。折扣如果先于下限算，兜完还是 5，
     * 会员在小额调用上的折扣就完全失效了。顺序反过来才有 3。
     */
    expect(chargedMicroFor(tiny)).toBe(5);
    expect(chargedMicroFor({ ...tiny, vipDiscountBps: 4000 })).toBe(3);
  });

  it("VIP 10% 折扣按四舍五入算", () => {
    expect(
      chargedMicroFor({
        costUsd: 0.0003,
        usdPerCredit: USD_PER_CREDIT,
        multiplierBps: 13000,
        vipDiscountBps: 1000,
      })
    ).toBe(35); // round(39 × 0.9) = 35.1 → 35
  });

  it("单点美元价非法时不收费，而不是算出 Infinity", () => {
    expect(chargedMicroFor({ costUsd: 0.01, usdPerCredit: 0, multiplierBps: 13000 })).toBe(0);
  });
});

describe("微点结算", () => {
  it("攒不满 1 点就不动余额", () => {
    expect(settleDebt(0, 39)).toEqual({ credits: 0, restMicro: 39 });
    expect(settleDebt(900, 99)).toEqual({ credits: 0, restMicro: 999 });
  });

  it("满 1000 才扣，零头留着", () => {
    expect(settleDebt(980, 39)).toEqual({ credits: 1, restMicro: 19 });
  });

  it("一次就超过好几点也算得对", () => {
    expect(settleDebt(500, 2600)).toEqual({ credits: 3, restMicro: 100 });
  });

  it("反复调用累计下来与一次性算的结果一致", () => {
    // 25 次基础档 × 0.039 点 = 0.975 点，一次都不该扣
    let debt = 0;
    let credits = 0;
    for (let i = 0; i < 25; i++) {
      const r = settleDebt(debt, 39);
      debt = r.restMicro;
      credits += r.credits;
    }
    expect(credits).toBe(0);
    expect(debt).toBe(975);
    // 第 26 次跨过 1 点
    expect(settleDebt(debt, 39).credits).toBe(1);
  });
});

describe("单位换算", () => {
  it("美元转 μ$ 取整", () => {
    expect(usdToMicro(0.0003)).toBe(300);
    expect(usdToMicro(0.0000004)).toBe(0);
    expect(usdToMicro(-1)).toBe(0);
  });

  it("显示时去掉无意义的尾零", () => {
    expect(formatMicroCredits(39)).toBe("0.039");
    expect(formatMicroCredits(1000)).toBe("1");
    expect(formatMicroCredits(1500)).toBe("1.5");
    expect(formatMicroCredits(0)).toBe("0");
  });
});
