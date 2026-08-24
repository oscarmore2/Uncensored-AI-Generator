import { describe, it, expect, afterEach } from "vitest";
import { acquireUserLock, __resetUserLocks } from "./user-lock";

afterEach(() => __resetUserLocks());

describe("用户级互斥", () => {
  it("同一个 key 第二次抢不到", () => {
    const release = acquireUserLock("u:1", 1000);
    expect(release).not.toBeNull();
    expect(acquireUserLock("u:1", 1000)).toBeNull();
  });

  it("释放之后可以再抢", () => {
    acquireUserLock("u:1", 1000)?.();
    expect(acquireUserLock("u:1", 1000)).not.toBeNull();
  });

  it("不同用户互不影响", () => {
    acquireUserLock("u:1", 1000);
    expect(acquireUserLock("u:2", 1000)).not.toBeNull();
  });

  it("过期的锁自动让位", () => {
    acquireUserLock("u:1", -1);
    expect(acquireUserLock("u:1", 1000)).not.toBeNull();
  });

  it("超时后迟到的释放不会误放掉别人的锁", () => {
    // 进程卡住 → 锁过期 → 第二个请求拿到锁 → 第一个请求这才走完 finally。
    // 如果无脑 delete，第三个请求就会和第二个同时在跑
    const stale = acquireUserLock("u:1", -1);
    const fresh = acquireUserLock("u:1", 1000);
    stale?.();
    expect(acquireUserLock("u:1", 1000)).toBeNull();
    fresh?.();
    expect(acquireUserLock("u:1", 1000)).not.toBeNull();
  });

  it("重复释放只生效一次", () => {
    const release = acquireUserLock("u:1", 1000);
    release?.();
    const second = acquireUserLock("u:1", 1000);
    release?.();
    expect(acquireUserLock("u:1", 1000)).toBeNull();
    second?.();
  });
});
