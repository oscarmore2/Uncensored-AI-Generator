import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:1/unused";
process.env.AUTH_SECRET ??= "test-only-secret-test-only-secret-abc";

/* 上游与收尾都换成假的：这里要验的是重查自己的决策，不是它们的实现 */
const poll = vi.fn();
const settleSuccess = vi.fn(async (..._a: unknown[]): Promise<string> => "settled");
const failAndRefund = vi.fn(async (..._a: unknown[]): Promise<void> => {});
const markTimeout = vi.fn(async (..._a: unknown[]): Promise<void> => {});

vi.mock("./providers", () => ({
  getAdapter: () => ({ getCredentials: async () => ({ apiKey: "k" }), poll }),
  mapProviderStatus: (s: string) => s,
}));
vi.mock("./generation-settle", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  settleSuccess: (...a: unknown[]) => settleSuccess(...a),
  failAndRefund: (...a: unknown[]) => failAndRefund(...a),
  markTimeout: (...a: unknown[]) => markTimeout(...a),
}));

const { needsRecheck, recheckOne } = await import("./generation-recheck");

/**
 * 「该不该接管」判错的两个方向都很难查：
 * 判宽了会和还活着的那条轮询抢同一个任务（两边同时收尾）；
 * 判严了记录就永远卡在那儿，而那正是这次要修的毛病。
 */
const ago = (ms: number) => new Date(Date.now() - ms);
const MIN = 60_000;

describe("哪些任务该回上游重查", () => {
  it("超时的立刻接管——它就是明确交接出来的", () => {
    expect(needsRecheck({ status: "timeout", updatedAt: new Date() })).toBe(true);
  });

  it("**刚更新过的 processing 不碰**——那条轮询还活着", () => {
    expect(needsRecheck({ status: "processing", updatedAt: ago(1 * MIN) })).toBe(false);
    expect(needsRecheck({ status: "queued", updatedAt: ago(10 * MIN) })).toBe(false);
  });

  it("久未更新的 processing 要接管——多半是容器重启把轮询打断了", () => {
    expect(needsRecheck({ status: "processing", updatedAt: ago(30 * MIN) })).toBe(true);
    expect(needsRecheck({ status: "pending", updatedAt: ago(60 * MIN) })).toBe(true);
  });

  it("已有终局的一概不动", () => {
    const ok = JSON.stringify(["https://cdn.example.com/a.mp4"]);
    expect(needsRecheck({ status: "succeeded", updatedAt: ago(99 * MIN), resultUrls: ok })).toBe(false);
    for (const status of ["failed", "partial"]) {
      expect(needsRecheck({ status, updatedAt: ago(99 * MIN) })).toBe(false);
    }
  });

  it("**「已完成却没有任何媒体」要接管**——那不是终局，是坏掉的记录", () => {
    // 上游报了成功、我们却没能把地址捞出来。不接管的话它永远不会自己好
    for (const resultUrls of [null, undefined, "[]", "坏掉的 JSON", JSON.stringify([""])]) {
      expect(needsRecheck({ status: "succeeded", updatedAt: new Date(), resultUrls })).toBe(true);
    }
  });

  it("接管门槛比轮询预算长——两者不能重叠", () => {
    // 轮询守 20 分钟，门槛 25 分钟：中间留 5 分钟余量给收尾
    expect(needsRecheck({ status: "processing", updatedAt: ago(21 * MIN) })).toBe(false);
    expect(needsRecheck({ status: "processing", updatedAt: ago(26 * MIN) })).toBe(true);
  });
});

/**
 * 「已完成却没有媒体」是上游**认过**的成功，我们只是没把地址捞出来。
 * 重查对它只有一个权利：把地址补回来。判它失败就是把一条真出了片的作品
 * 变成「失败并退款」——那正是重查本身要治的病，从另一个门又走了一遍。
 */
describe("重查不许给上游认过的成功降级", () => {
  const brokenSuccess = {
    id: 306,
    status: "succeeded",
    provider: "atlas",
    providerJobId: "job-306",
    // 早就过了 24 小时的放弃线——正是会踩到旧收尾逻辑的那种
    createdAt: ago(48 * 60 * MIN),
  };

  beforeEach(() => {
    poll.mockReset();
    settleSuccess.mockReset().mockResolvedValue("settled");
    failAndRefund.mockReset();
    markTimeout.mockReset();
  });

  it("捞回地址就补上——这是重查对它唯一该做的事", async () => {
    poll.mockResolvedValue({ status: "succeeded", outputs: ["https://cdn.example.com/a.mp4"], thumbnails: [] });
    await expect(recheckOne(brokenSuccess)).resolves.toBe(true);
    expect(settleSuccess).toHaveBeenCalledOnce();
    expect(failAndRefund).not.toHaveBeenCalled();
  });

  it("**上游还是给不出地址：原样留着，绝不退款**", async () => {
    poll.mockResolvedValue({ status: "succeeded", outputs: [], thumbnails: [] });
    await expect(recheckOne(brokenSuccess)).resolves.toBe(false);
    expect(failAndRefund).not.toHaveBeenCalled();
    expect(markTimeout).not.toHaveBeenCalled();
  });

  it("**上游现在说失败也不信**——多半是任务记录被清理了，不是真失败", async () => {
    poll.mockResolvedValue({ status: "failed", outputs: [], error: "not found" });
    await expect(recheckOne(brokenSuccess)).resolves.toBe(false);
    expect(failAndRefund).not.toHaveBeenCalled();
  });

  it("**上游压根问不通也不动它**", async () => {
    poll.mockRejectedValue(new Error("connect ECONNREFUSED"));
    await expect(recheckOne(brokenSuccess)).resolves.toBe(false);
    expect(failAndRefund).not.toHaveBeenCalled();
  });

  it("对照：真正未决的老任务，超过 24 小时该收尾还是要收尾", async () => {
    poll.mockResolvedValue({ status: "processing", outputs: [] });
    await expect(recheckOne({ ...brokenSuccess, status: "timeout" })).resolves.toBe(true);
    expect(failAndRefund).toHaveBeenCalledOnce();
  });
});
