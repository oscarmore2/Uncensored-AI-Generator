import { describe, it, expect } from "vitest";

process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:1/unused";
process.env.AUTH_SECRET ??= "test-only-secret-test-only-secret-abc";

const { needsRecheck } = await import("./generation-recheck");

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
    for (const status of ["succeeded", "failed", "partial"]) {
      expect(needsRecheck({ status, updatedAt: ago(99 * MIN) })).toBe(false);
    }
  });

  it("接管门槛比轮询预算长——两者不能重叠", () => {
    // 轮询守 20 分钟，门槛 25 分钟：中间留 5 分钟余量给收尾
    expect(needsRecheck({ status: "processing", updatedAt: ago(21 * MIN) })).toBe(false);
    expect(needsRecheck({ status: "processing", updatedAt: ago(26 * MIN) })).toBe(true);
  });
});
