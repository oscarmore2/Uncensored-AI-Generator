import "server-only";
import { db } from "./db";
import {
  getActiveOssConfig,
  mirrorRemoteUrls,
  objectKeyFromPublicUrl,
  type OssConfig,
} from "./oss";

/**
 * 把「本该在自家 OSS、实际还挂在上游」的媒体补抓回来。
 *
 * 背景：lib/safe-url.ts 的来源白名单漏了 Atlas 的分发域（cloudfront.net）
 * 与火山引擎 TOS（volces.com），而 mirrorRemoteUrls 失败时会静默回落到上游
 * 直链。结果是 Atlas 系的产出一次都没镜像成功，上游一清理就整片裂图。
 *
 * 白名单补上之后，新产出不会再出问题；这个补录负责存量数据。
 * 上游已经清掉的救不回来（HEAD 直接 403/404），只能标记出来让人工处理。
 *
 * 只补两类：
 *   - PublicWork：挂在探索页上，最该长期可用
 *   - Generation：用户自己的作品，未过期且未被清理的才补
 */

export interface BackfillReport {
  dryRun: boolean;
  scanned: { publicWorks: number; generations: number };
  /** 本来就在自家 OSS 上，不用动 */
  alreadyMirrored: number;
  /** 上游还活着，这次补录成功 */
  rescued: number;
  /** 上游已经没了，救不回来 */
  dead: number;
  /** 其他失败（超时、体积超限等），可以重试 */
  failed: number;
  details: Array<{
    kind: "public_work" | "generation";
    id: number;
    url: string;
    outcome: "rescued" | "dead" | "failed";
    note?: string;
  }>;
}

/** 上游是否还能取到；只读一个字节，不下载整包 */
async function stillAlive(url: string): Promise<boolean> {
  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { Range: "bytes=0-0" },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    return resp.ok || resp.status === 206;
  } catch {
    return false;
  }
}

function isOurs(cfg: OssConfig, url: string): boolean {
  return objectKeyFromPublicUrl(cfg, url) !== null;
}

export async function runMediaBackfill(opts: {
  dryRun?: boolean;
  limit?: number;
}): Promise<BackfillReport> {
  const dryRun = Boolean(opts.dryRun);
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);

  const report: BackfillReport = {
    dryRun,
    scanned: { publicWorks: 0, generations: 0 },
    alreadyMirrored: 0,
    rescued: 0,
    dead: 0,
    failed: 0,
    details: [],
  };

  const cfg = await getActiveOssConfig();
  if (!cfg) throw new Error("OSS 未配置，无法补录");
  if (!cfg.mirrorResults) throw new Error("当前 OSS 账户关闭了镜像（mirrorResults=false），先打开再补录");

  // ---- PublicWork ----
  // 必须从最新的扫起。定时任务每轮只看 limit 条，若从最旧扫起会永远卡在
  // 那批早就失效、救不回来的老数据上，真正处在 24 小时窗口里的新作品反而扫不到。
  const works = await db.publicWork.findMany({
    orderBy: { id: "desc" },
    take: limit,
    select: { id: true, mediaUrl: true, thumbUrl: true },
  });
  report.scanned.publicWorks = works.length;

  for (const w of works) {
    // thumbUrl 常常等于 mediaUrl，去重后再补，别把同一个文件传两遍
    const targets = [...new Set([w.mediaUrl, w.thumbUrl].filter((u): u is string => Boolean(u)))];
    const remap = new Map<string, string>();

    for (const url of targets) {
      if (isOurs(cfg, url)) {
        report.alreadyMirrored += 1;
        continue;
      }
      if (!(await stillAlive(url))) {
        report.dead += 1;
        report.details.push({ kind: "public_work", id: w.id, url, outcome: "dead", note: "上游已不可用" });
        continue;
      }
      if (dryRun) {
        report.rescued += 1;
        report.details.push({ kind: "public_work", id: w.id, url, outcome: "rescued", note: "dry-run，未写入" });
        continue;
      }
      const [mirrored] = await mirrorRemoteUrls([url], `public/backfill-${w.id}`, cfg);
      if (mirrored && isOurs(cfg, mirrored)) {
        remap.set(url, mirrored);
        report.rescued += 1;
        report.details.push({ kind: "public_work", id: w.id, url, outcome: "rescued" });
      } else {
        report.failed += 1;
        report.details.push({ kind: "public_work", id: w.id, url, outcome: "failed", note: "镜像未落地" });
      }
    }

    if (!dryRun && remap.size) {
      await db.publicWork.update({
        where: { id: w.id },
        data: {
          mediaUrl: remap.get(w.mediaUrl) ?? w.mediaUrl,
          thumbUrl: w.thumbUrl ? (remap.get(w.thumbUrl) ?? w.thumbUrl) : w.thumbUrl,
        },
      });
    }
  }

  // ---- Generation ----
  // 已软删或媒体已被清理的不补：那是正常生命周期，不是这次的 bug
  const gens = await db.generation.findMany({
    where: {
      status: "succeeded",
      resultUrls: { not: null },
      deletedAt: null,
      mediaDeletedAt: null,
    },
    orderBy: { id: "desc" },
    take: limit,
    select: { id: true, resultUrls: true },
  });
  report.scanned.generations = gens.length;

  for (const g of gens) {
    let urls: string[];
    try {
      urls = JSON.parse(g.resultUrls ?? "[]") as string[];
    } catch {
      continue;
    }
    if (!Array.isArray(urls) || !urls.length) continue;

    const next = [...urls];
    let changed = false;

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      if (typeof url !== "string" || !url.startsWith("http")) continue;
      if (isOurs(cfg, url)) {
        report.alreadyMirrored += 1;
        continue;
      }
      if (!(await stillAlive(url))) {
        report.dead += 1;
        report.details.push({ kind: "generation", id: g.id, url, outcome: "dead", note: "上游已不可用" });
        continue;
      }
      if (dryRun) {
        report.rescued += 1;
        report.details.push({ kind: "generation", id: g.id, url, outcome: "rescued", note: "dry-run，未写入" });
        continue;
      }
      const [mirrored] = await mirrorRemoteUrls([url], `generations/${g.id}`, cfg);
      if (mirrored && isOurs(cfg, mirrored)) {
        next[i] = mirrored;
        changed = true;
        report.rescued += 1;
        report.details.push({ kind: "generation", id: g.id, url, outcome: "rescued" });
      } else {
        report.failed += 1;
        report.details.push({ kind: "generation", id: g.id, url, outcome: "failed", note: "镜像未落地" });
      }
    }

    if (!dryRun && changed) {
      await db.generation.update({
        where: { id: g.id },
        data: { resultUrls: JSON.stringify(next) },
      });
    }
  }

  return report;
}
