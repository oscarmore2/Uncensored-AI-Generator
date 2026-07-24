import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { GuestHeader } from "@/components/GuestHeader";
import { AdaptiveMedia } from "@/components/WorkMedia";

export const dynamic = "force-dynamic";

const MODE_LABELS: Record<string, string> = {
  txt2img: "文生图",
  txt2vid: "文生视频",
  img2img: "图生图",
  img2vid: "图生视频",
  undress: "图像编辑",
};

export default async function WorkDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workId = Number(id);
  if (!Number.isInteger(workId)) notFound();

  const [session, work] = await Promise.all([
    getSession(),
    db.publicWork.findFirst({ where: { id: workId, isPublished: true } }),
  ]);
  if (!work) notFound();

  let paramEntries: [string, unknown][] = [];
  try {
    paramEntries = Object.entries(JSON.parse(work.params) as Record<string, unknown>);
  } catch {
    // params 非法 JSON 时不展示
  }

  // 同款参数创作：把 prompt/negative/mode 带进创作中心；未登录先走登录并回跳
  const remixQuery = new URLSearchParams({
    prompt: work.prompt,
    ...(work.negativePrompt ? { negative: work.negativePrompt } : {}),
    mode: work.mode,
  }).toString();
  const makeUrl = `/make?${remixQuery}`;
  const ctaHref = session ? makeUrl : `/login?mode=register&next=${encodeURIComponent(makeUrl)}`;

  return (
    <div className="min-h-screen">
      <GuestHeader />
      <div className="max-w-6xl mx-auto px-6 pt-8 pb-16">
        <Link href="/explore" className="text-sm text-gray-400 hover:text-white">
          <i className="fas fa-arrow-left mr-2" />
          返回探索
        </Link>

        <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-7">
            <div className="rounded-3xl overflow-hidden border border-white/10 bg-[#111]">
              <AdaptiveMedia mode={work.mode} src={work.mediaUrl} poster={work.thumbUrl} />
            </div>
          </div>

          <div className="lg:col-span-5 space-y-5">
            <div>
              <span className="media-badge">{MODE_LABELS[work.mode] ?? work.mode}</span>
              <h1 className="text-2xl font-bold tracking-tight mt-3">{work.title ?? "社区作品"}</h1>
            </div>

            <div className="glass rounded-3xl p-5">
              <div className="text-xs font-semibold text-gray-400 mb-2">提示词 (Prompt)</div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{work.prompt}</p>
            </div>

            {work.negativePrompt && (
              <div className="glass rounded-3xl p-5">
                <div className="text-xs font-semibold text-gray-400 mb-2">负面提示词 (Negative)</div>
                <p className="text-sm text-gray-300">{work.negativePrompt}</p>
              </div>
            )}

            {paramEntries.length > 0 && (
              <div className="glass rounded-3xl p-5">
                <div className="text-xs font-semibold text-gray-400 mb-3">生成参数</div>
                <div className="space-y-2 text-xs">
                  {paramEntries.map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-x-4">
                      <span className="text-gray-400 font-mono">{k}</span>
                      <span className="font-mono text-right break-all">{String(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="pt-2">
              <Link
                href={ctaHref}
                className="generate-btn block w-full py-4 text-white font-bold text-lg rounded-3xl text-center shadow-xl active:scale-[0.985]"
              >
                <i className="fas fa-magic mr-2" />
                {session ? "用同款参数创作" : "注册后用同款参数创作"}
              </Link>
              {!session && (
                <p className="text-center text-xs text-gray-500 mt-3">注册即送体验点数，参数自动带入创作中心</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
