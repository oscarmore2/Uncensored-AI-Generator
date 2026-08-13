/**
 * 触发下载的客户端小工具。
 *
 * 一律走 /api/media/download 这条同源代理，不要直接把 OSS 链接丢给 <a download>——
 * download 属性对跨域 URL 会被浏览器忽略，那样只会在新标签页打开文件。
 * 详见 api/media/download/route.ts 的说明。
 */

export type DownloadSource = { gen: number } | { work: number };

export function downloadHref(source: DownloadSource, index = 0): string {
  const key = "gen" in source ? `gen=${source.gen}` : `work=${source.work}`;
  return `/api/media/download?${key}&i=${index}`;
}

/** 点一次，下一个文件 */
export function downloadOne(source: DownloadSource, index = 0): void {
  const a = document.createElement("a");
  a.href = downloadHref(source, index);
  // 文件名由服务端的 Content-Disposition 决定，这里给个空值即可
  a.download = "";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * 批量下载：逐个触发，中间留间隔。
 *
 * 不做 zip：那需要把所有文件读进内存再压，一条视频就能把手机浏览器顶爆。
 * 连续触发时浏览器会弹一次「是否允许下载多个文件」，用户放行即可——
 * 间隔太短的话后面几个会被直接丢掉（不是拦截，是静默丢），所以要错开。
 */
export async function downloadMany(
  source: DownloadSource,
  count: number,
  gapMs = 400
): Promise<void> {
  for (let i = 0; i < count; i++) {
    downloadOne(source, i);
    if (i < count - 1) await new Promise((r) => setTimeout(r, gapMs));
  }
}
