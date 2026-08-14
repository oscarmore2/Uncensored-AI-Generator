/**
 * 把还挂在上游、没镜像到自家 OSS 的媒体补抓回来。
 *
 * 走线上接口而不是直连数据库：OSS 凭据本来就在服务端，
 * 本地跑不需要拿到任何生产密钥，也不用连生产库。
 *
 *   APP_URL=https://www.wanwankewu.cc MEDIA_CLEANUP_SECRET=xxx \
 *     node scripts/media-backfill.mjs            # 只体检，不写库
 *
 *   ... node scripts/media-backfill.mjs --apply  # 真的补录
 *
 * 可选 MEDIA_BACKFILL_LIMIT（默认 50，上限 500）。
 * 上游已经清掉的救不回来，会记在 dead 里，只能重新生成或从公共库下架。
 */

const appUrl = process.env.APP_URL;
const secret = process.env.MEDIA_CLEANUP_SECRET;

if (!appUrl || !secret) {
  console.error("需要 APP_URL 与 MEDIA_CLEANUP_SECRET");
  process.exit(1);
}

const apply = process.argv.includes("--apply");
// 定时跑时要扫得多一点：已经镜像好的判定只是字符串比较、不发网络请求，
// 真正花时间的只有那几条还挂在上游的
const limit = Number(process.env.MEDIA_BACKFILL_LIMIT || (apply ? 200 : 50));

console.log(apply ? "== 补录模式：会写库 ==" : "== 体检模式：不写库（加 --apply 才真补）==");

const response = await fetch(`${appUrl.replace(/\/$/, "")}/api/internal/media-backfill`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ dry_run: !apply, limit }),
  signal: AbortSignal.timeout(290_000),
});

const text = await response.text();
if (!response.ok) {
  console.error(`补录失败: HTTP ${response.status} ${text}`);
  process.exit(1);
}

const r = JSON.parse(text);
console.log(
  `\n扫描：公共作品 ${r.scanned.publicWorks} 条，用户作品 ${r.scanned.generations} 条`
);
console.log(`  已在自家 OSS：${r.alreadyMirrored}`);
console.log(`  ✅ 补录成功：${r.rescued}`);
console.log(`  ⛔ 上游已失效，救不回来：${r.dead}`);
console.log(`  ⚠️  失败可重试：${r.failed}`);

if (r.details.length) {
  console.log("\n明细：");
  for (const d of r.details) {
    const tag = d.outcome === "rescued" ? "✅" : d.outcome === "dead" ? "⛔" : "⚠️ ";
    console.log(`  ${tag} ${d.kind}#${d.id}  ${d.note ?? ""}  ${d.url.slice(0, 100)}`);
  }
}

if (r.dead > 0) {
  console.log(
    `\n有 ${r.dead} 个文件上游已经没了。公共库里的建议下架，用户作品只能提示已过期。`
  );
}
