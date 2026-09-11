import "server-only";
import { db } from "./db";
import { getAdapter, mapProviderStatus } from "./providers";
import { failAndRefund, markTimeout, settleSuccess, OPEN_STATUSES } from "./generation-settle";

/**
 * 回上游重新确认那些还没有终局的任务。
 *
 * 为什么需要它：提交时那条轮询只守一段时间（见 generation-runner 的
 * POLL_BUDGET_MS）。守不到结论就标超时——而超时**不是结论**。以前那一版
 * 直接判失败并退款，上游后来真出片了也没人改回来，用户看到的是一条永久错的
 * 「失败」记录，那才是最严重的地方：数据错了，而且再也不会自己好。
 *
 * 除了超时，还有一类同样治不好的：容器重启把轮询打断了，记录永远停在
 * processing。它们和超时是同一个病，所以一起接管。
 */

/** 轮询早该结束了才接管，否则会和还活着的那条轮询抢同一个任务 */
const TAKEOVER_AFTER_MS = 25 * 60_000;

/**
 * 多久之后不再等了。
 *
 * 上游任务再慢也有个头；一直挂着「进行中」既占着用户的点数，也让人不知道
 * 该不该重做。到点就按失败退款——那时它才**真的**是一个没有结果的任务。
 */
const GIVE_UP_AFTER_MS = 24 * 3_600_000;

/** 一次最多重查几条。历史记录里可能积着一堆，不能让一次打开变成几十个上游请求 */
const MAX_PER_RUN = 8;

export type RecheckOutcome = {
  checked: number;
  settled: number;
};

/** 这条记录还没有终局，而且已经没人在管它了 */
export function needsRecheck(row: { status: string; updatedAt: Date }): boolean {
  if (!(OPEN_STATUSES as readonly string[]).includes(row.status)) return false;
  // 超时是明确交接出来的，不必等；其余非终局状态要等轮询确实死了才接手
  if (row.status === "timeout") return true;
  return Date.now() - row.updatedAt.getTime() > TAKEOVER_AFTER_MS;
}

/**
 * 重查一个用户名下的未决任务。
 *
 * 只碰这个用户自己的记录——入口是「打开历史记录」，没有理由让它去动别人的。
 */
export async function recheckUserGenerations(userId: number): Promise<RecheckOutcome> {
  const rows = await db.generation.findMany({
    where: {
      userId,
      deletedAt: null,
      status: { in: [...OPEN_STATUSES] },
      providerJobId: { not: null },
    },
    orderBy: { createdAt: "desc" },
    take: MAX_PER_RUN * 3,
    select: {
      id: true,
      status: true,
      provider: true,
      providerJobId: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const due = rows.filter(needsRecheck).slice(0, MAX_PER_RUN);
  if (due.length === 0) return { checked: 0, settled: 0 };

  const results = await Promise.all(due.map((row) => recheckOne(row)));
  return { checked: due.length, settled: results.filter(Boolean).length };
}

/** 重查单条。返回是否落了终局 */
export async function recheckOne(row: {
  id: number;
  status: string;
  provider: string;
  providerJobId: string | null;
  createdAt: Date;
}): Promise<boolean> {
  if (!row.providerJobId) return false;

  const tooOld = Date.now() - row.createdAt.getTime() > GIVE_UP_AFTER_MS;

  try {
    const adapter = getAdapter(row.provider);
    const creds = await adapter.getCredentials();
    if (!creds) {
      // 渠道凭据被换掉/停用了，问不出来。等下次，别把记录判死
      if (tooOld) await failAndRefund(row.id, "超过 24 小时未能向上游确认结果");
      return tooOld;
    }

    const result = await adapter.poll(creds.apiKey, row.providerJobId);
    const mapped = mapProviderStatus(result.status);

    if (mapped === "succeeded" && result.outputs.length > 0) {
      /*
       * 到这里才是真成功。走与首次收尾**同一个** settleSuccess：
       * 出口审查和 URL 镜像一步都不能省——镜像省了的话上游一清理就是一片裂图。
       */
      const outcome = await settleSuccess({
        genId: row.id,
        outputs: result.outputs,
        thumbnails: result.thumbnails,
        // 重查拿不到当初那份入参，实时单价就不算了；成本看板会退回目录基准价
        costUsd: null,
      });
      return outcome !== "gone";
    }

    if (mapped === "failed") {
      await failAndRefund(row.id, result.error || "上游返回失败");
      return true;
    }

    // 上游还在跑
    if (tooOld) {
      await failAndRefund(row.id, "上游超过 24 小时仍未出结果");
      return true;
    }
    await markTimeout(row.id, result.error);
    return false;
  } catch (err) {
    /*
     * 问不通不是结论。网络抖一下就把记录判死，比不查还糟。
     * 只有确实等太久了才收尾。
     */
    console.warn(`[recheck] ${row.id} 查询失败:`, err);
    if (tooOld) await failAndRefund(row.id, "超过 24 小时未能向上游确认结果");
    return tooOld;
  }
}
