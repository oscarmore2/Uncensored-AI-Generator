import { describe, it, expect, beforeEach, vi } from "vitest";

process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:1/unused";
process.env.AUTH_SECRET ??= "test-only-secret-test-only-secret-abc";

/**
 * 退款去重。
 *
 * 原来只靠「状态不是 failed」这一次抢占，前提是「一旦 failed 就永远 failed」。
 * 这个前提已经被恢复脚本打破了（failed → timeout → failed），于是同一个任务
 * 会退两次款。钱的 bug 没有「下次注意」，必须钉住。
 */

type Row = Record<string, unknown> & { id: number };
const state = {
  rows: [] as Row[],
  refunds: [] as Record<string, unknown>[],
  balanceAdded: 0,
};

vi.mock("./telegram", () => ({ sendTelegram: () => {} }));
vi.mock("./content-safety", () => ({
  reviewImages: async () => ({ level: "safe", categories: [], reason: "", source: "local" }),
  isAdultContent: () => false,
  safetyAudit: () => [],
}));
vi.mock("./oss", () => ({ mirrorRemoteUrls: async (urls: string[]) => urls }));
vi.mock("./db", () => ({
  db: {
    generation: {
      findUnique: async ({ where }: { where: { id: number } }) =>
        state.rows.find((r) => r.id === where.id) ?? null,
      update: async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
        const row = state.rows.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: number; status?: { not?: string; notIn?: string[] } };
        data: Record<string, unknown>;
      }) => {
        const row = state.rows.find((r) => r.id === where.id);
        if (!row) return { count: 0 };
        const st = where.status;
        if (st?.not !== undefined && row.status === st.not) return { count: 0 };
        if (st?.notIn && st.notIn.includes(row.status as string)) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
    user: {
      update: async ({ data }: { data: { balance: { increment: number } } }) => {
        state.balanceAdded += data.balance.increment;
        return {};
      },
    },
    transaction: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.refunds.push(data);
        return data;
      },
    },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  },
}));

const { failAndRefund } = await import("./generation-settle");

function seed(over: Partial<Row> = {}) {
  state.rows = [
    {
      id: 1,
      userId: 7,
      status: "processing",
      cost: 30,
      mode: "txt2vid",
      tier: "mid",
      spicy: false,
      params: "{}",
      ...over,
    },
  ];
  state.refunds = [];
  state.balanceAdded = 0;
}

beforeEach(() => seed());

describe("失败退款", () => {
  it("第一次失败会退款，并在记录上留痕", async () => {
    await failAndRefund(1, "上游返回失败");
    expect(state.balanceAdded).toBe(30);
    expect(state.refunds).toHaveLength(1);
    expect(JSON.parse(state.rows[0].params as string).refunded_at).toBeTruthy();
    expect(state.rows[0].status).toBe("failed");
  });

  it("已经是 failed 的记录再调一次，什么都不做", async () => {
    seed({ status: "failed" });
    await failAndRefund(1, "再来一次");
    expect(state.refunds).toHaveLength(0);
  });

  it("**翻回 timeout 再判失败时不会再退一次**", async () => {
    await failAndRefund(1, "第一次");
    // 恢复脚本干的事：把它翻回 timeout（留痕还在）
    state.rows[0].status = "timeout";

    await failAndRefund(1, "重查确认确实失败了");
    expect(state.rows[0].status).toBe("failed");
    // 状态抢占会放行，靠的是 refunded_at 才拦住
    expect(state.balanceAdded).toBe(30);
    expect(state.refunds).toHaveLength(1);
  });

  it("恢复脚本写的 legacy 标记同样能拦住", async () => {
    seed({ status: "timeout", params: JSON.stringify({ refunded_at: "legacy" }) });
    await failAndRefund(1, "重查确认确实失败了");
    expect(state.balanceAdded).toBe(0);
    expect(state.refunds).toHaveLength(0);
    // 但状态还是要落到 failed
    expect(state.rows[0].status).toBe("failed");
  });

  it("params 损坏时按没退过处理——宁可多退也不要漏掉该退的", async () => {
    seed({ params: "{坏掉的 JSON" });
    await failAndRefund(1, "失败");
    expect(state.refunds).toHaveLength(1);
  });
});
