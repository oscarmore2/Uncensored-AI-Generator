import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { assertSafeRemoteMediaUrl } from "@/lib/safe-url";
import { downloadExtOf } from "@/lib/plaything-categories";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * 同源下载代理。
 *
 * 为什么非要这一道：媒体在 OSS/上游 CDN 上，对站点是跨域的，而 <a download>
 * 的 download 属性对跨域 URL 会被浏览器直接忽略——点「下载」实际是在新标签页
 * 打开文件，我们精心拼的 wanwankewu_123.png 这个文件名从来没生效过。
 * 批量下载更明显：连开 N 个跨域链接触发的是弹窗拦截（N 个标签页），
 * 而不是「是否允许下载多个文件」那个授权提示。
 *
 * 同源之后 download 才生效、文件名才生效、批量才会走浏览器的下载授权。
 * 代价是媒体字节要过一遍自己的服务器。
 *
 * 安全：只接受「作品 id + 序号」，绝不接受调用方传进来的 URL——
 * 那等于开一个任意 URL 的代理。URL 一律从库里按 id 取，取出来再过一遍
 * SSRF 白名单，防的是库里被写进脏数据的情况。
 */

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** 解析出「这条记录的第 index 个文件」，同时完成鉴权 */
async function resolveTarget(
  params: URLSearchParams
): Promise<{ url: string; filename: string } | NextResponse> {
  const index = Number(params.get("i") ?? "0");
  if (!Number.isInteger(index) || index < 0) return badRequest("序号无效");

  const genParam = params.get("gen");
  const workParam = params.get("work");

  if (genParam) {
    const genId = Number(genParam);
    if (!Number.isInteger(genId) || genId <= 0) return badRequest("作品 id 无效");

    const user = await getCurrentUser();
    if (!user) return badRequest("请先登录", 401);

    // 只认本人名下且未软删的，别让 id 变成可枚举的越权入口
    const gen = await db.generation.findFirst({
      where: { id: genId, userId: user.id, deletedAt: null },
      select: { id: true, resultUrls: true, mediaDeletedAt: true },
    });
    if (!gen) return badRequest("作品不存在", 404);
    if (gen.mediaDeletedAt) return badRequest("媒体已过期清理", 410);

    const urls = gen.resultUrls ? (JSON.parse(gen.resultUrls) as string[]) : [];
    const url = urls[index];
    if (typeof url !== "string") return badRequest("该序号没有文件", 404);
    return { url, filename: `wanwankewu_${gen.id}_${index + 1}.${downloadExtOf(url)}` };
  }

  if (workParam) {
    const workId = Number(workParam);
    if (!Number.isInteger(workId) || workId <= 0) return badRequest("作品 id 无效");

    // 公共作品不需要登录，但必须是已发布的
    const work = await db.publicWork.findFirst({
      where: { id: workId, isPublished: true },
      select: { id: true, mediaUrl: true },
    });
    if (!work) return badRequest("作品不存在", 404);
    if (index !== 0) return badRequest("该序号没有文件", 404);
    return {
      url: work.mediaUrl,
      filename: `wanwankewu_w${work.id}.${downloadExtOf(work.mediaUrl)}`,
    };
  }

  return badRequest("缺少 gen 或 work 参数");
}

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const target = await resolveTarget(params);
  if (target instanceof NextResponse) return target;

  try {
    await assertSafeRemoteMediaUrl(target.url);
  } catch {
    return badRequest("该文件的来源不在允许列表内", 502);
  }

  let upstream: Response;
  try {
    upstream = await fetch(target.url, {
      redirect: "follow",
      signal: AbortSignal.timeout(110_000),
    });
  } catch {
    return badRequest("回源失败，请稍后重试", 502);
  }
  if (!upstream.ok || !upstream.body) {
    // 上游已经清掉是最常见的情况，给个能看懂的话
    const hint = upstream.status === 403 || upstream.status === 404 ? "文件已被上游清理" : "回源失败";
    return badRequest(hint, 502);
  }

  const headers = new Headers({
    "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
    // filename* 用 UTF-8 编码，文件名里有中文时不会变成乱码
    "Content-Disposition": `attachment; filename="${target.filename}"; filename*=UTF-8''${encodeURIComponent(target.filename)}`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  const len = upstream.headers.get("content-length");
  if (len) headers.set("Content-Length", len);

  // 直接把上游的流转出去，不要 buffer——视频动辄几十 MB，缓冲会把内存吃干
  return new Response(upstream.body, { status: 200, headers });
}
