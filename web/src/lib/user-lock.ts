import "server-only";

/**
 * 用户级互斥：同一时刻只允许一个 AI 动作在跑。
 *
 * 两个理由，缺一不可：
 *
 * 1. **交互**。编辑器规划第六节定了「同时只有一张结果卡」，多张卡片满天飞
 *    的时候用户根本分不清哪张对应哪一段。
 * 2. **计费**。先校验余额、后按真实用量扣费，中间那段窗口可以并发发起多次
 *    调用来透支。前端那条规则挡不住脚本，闸门必须在服务端。
 *
 * 与 `rate-limit.ts` 同样是进程内状态：Railway 单实例场景下够用。
 * 多实例部署时两者要一起换成 Redis——只换一个会留下一半的洞。
 */

const locks = new Map<string, number>();

/**
 * 抢锁。抢到返回释放函数，没抢到返回 null。
 *
 * TTL 是**兜底**不是主要机制：正常路径一定会调释放函数。它防的是进程在
 * 请求中途挂掉——没有 TTL 的话那个用户就永远锁死了，只能重启才能再用。
 */
export function acquireUserLock(key: string, ttlMs: number): (() => void) | null {
  const now = Date.now();
  const until = locks.get(key);
  if (until != null && until > now) return null;

  const expires = now + ttlMs;
  locks.set(key, expires);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    // 只删自己那把：超时之后别人可能已经拿到新锁了，删掉会放进第二个请求
    if (locks.get(key) === expires) locks.delete(key);
  };
}

/** 测试用：清掉所有锁 */
export function __resetUserLocks() {
  locks.clear();
}
