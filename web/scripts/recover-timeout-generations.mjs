import { PrismaClient } from "@prisma/client";

/**
 * 把被「超时当失败」误判的旧记录翻回 timeout，让重查去向上游确认真结论。
 *
 *   node scripts/recover-timeout-generations.mjs           # 只看不动（dry run）
 *   node scripts/recover-timeout-generations.mjs --apply   # 真的改
 *
 * 背景：旧版轮询守约 6.4 分钟，守不到就 failAndRefund 判成 failed 并退款，
 * 而且再没有任何路径会回上游确认。上游后来真出片了也没人改回来——
 * 那批记录是**永久错的**。
 *
 * 只挑那条 bug 留下的确切指纹：providerError 正好是「生成超时或未返回结果」。
 * 老代码里这个字符串只在 `lastError` 为空时出现，也就是「一路轮询下来上游
 * 一个错都没报，我们自己放弃了」——正是要救的那种。上游报过错的那些是真失败，
 * 不该白问一遍。
 *
 * **这些记录当初已经退过款。** 翻回去之后重查若判定失败会再走一次 failAndRefund，
 * 所以这里同时写上 params.refunded_at，让那边跳过退款（见 generation-settle.ts）。
 * 本脚本不动余额，也不撤销当初那笔退款。
 *
 * 一次性恢复，**不要挂进 db:deploy**。幂等：跑第二遍命中 0 条。
 */

const TIMEOUT_FINGERPRINT = "生成超时或未返回结果";
const apply = process.argv.includes("--apply");
const db = new PrismaClient();

try {
  const where = {
    status: "failed",
    providerError: TIMEOUT_FINGERPRINT,
    providerJobId: { not: null },
    resultUrls: null,
    deletedAt: null,
  };

  const targets = await db.generation.findMany({
    where,
    select: {
      id: true,
      userId: true,
      mode: true,
      provider: true,
      cost: true,
      params: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  // 参考：上游确实报过错的那些不在挑选范围内，打出来让人心里有数
  const realFailures = await db.generation.count({
    where: {
      status: "failed",
      providerJobId: { not: null },
      resultUrls: null,
      deletedAt: null,
      NOT: { providerError: TIMEOUT_FINGERPRINT },
    },
  });

  console.log(`[recover] 命中 ${targets.length} 条被超时误判的记录`);
  console.log(`[recover] 另有 ${realFailures} 条 failed 是上游报过错的，不动`);
  for (const g of targets.slice(0, 20)) {
    console.log(
      `  #${g.id} ${g.createdAt.toISOString().slice(0, 16)} ${g.provider}/${g.mode} 用户 ${g.userId} ${g.cost}pt`
    );
  }
  if (targets.length > 20) console.log(`  …还有 ${targets.length - 20} 条`);

  if (!apply) {
    console.log("\n[recover] 这是 dry run，什么都没改。确认无误后加 --apply 再跑一次。");
    process.exit(0);
  }

  let changed = 0;
  for (const g of targets) {
    let params = {};
    try {
      const v = JSON.parse(g.params);
      if (v && typeof v === "object" && !Array.isArray(v)) params = v;
    } catch {
      // 参数损坏不影响翻状态
    }
    await db.generation.update({
      where: { id: g.id },
      data: {
        status: "timeout",
        providerError: "当初被误判为失败，正在向上游重新确认结果",
        // 当初退过款了，别让重查再退一次
        params: JSON.stringify({ ...params, refunded_at: params.refunded_at ?? "legacy" }),
      },
    });
    changed += 1;
  }

  console.log(`\n[recover] 已翻回 timeout：${changed} 条。`);
  console.log("[recover] 用户下次打开历史记录时会自动向上游确认，拿到真结论才落终局。");
} catch (err) {
  console.error("[recover] 失败：", err.message);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
