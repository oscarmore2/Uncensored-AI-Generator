import Link from "next/link";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { GuestHeader } from "@/components/GuestHeader";
import { WorkMedia } from "@/components/WorkMedia";

export const dynamic = "force-dynamic";

export default async function LandingPage() {
  const [session, works] = await Promise.all([
    getSession(),
    db.publicWork.findMany({
      where: { isPublished: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      take: 8,
    }),
  ]);

  return (
    <div className="min-h-screen">
      <GuestHeader />

      {/* Hero：品牌 + 一句卖点 + CTA，背景用玫红氛围光 */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[900px] h-[600px] rounded-full bg-rose-600/20 blur-[160px]" />
          <div className="absolute bottom-0 right-0 w-[500px] h-[400px] rounded-full bg-pink-800/10 blur-[120px]" />
        </div>

        <div className="relative max-w-7xl mx-auto px-6 pt-24 pb-20 text-center">
          <div className="inline-flex items-center gap-x-4 mb-8">
            <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-rose-600 via-red-600 to-pink-700 flex items-center justify-center shadow-2xl shadow-rose-900/40">
              <span className="font-black text-white text-4xl tracking-tighter">AV</span>
            </div>
            <span className="font-black text-6xl md:text-7xl tracking-tighter">AVClubs</span>
          </div>

          <h1 className="text-2xl md:text-4xl font-bold tracking-tight text-gray-100 max-w-3xl mx-auto">
            用一句话，生成你想象中的成人内容
          </h1>
          <p className="mt-4 text-gray-400 max-w-xl mx-auto">
            AI 图片与视频生成，注册即送体验点数。
          </p>

          <div className="mt-10 flex items-center justify-center gap-x-4">
            <Link
              href={session ? "/make" : "/login?mode=register"}
              className="generate-btn px-10 py-4 text-white font-bold text-lg rounded-3xl shadow-xl active:scale-[0.985]"
            >
              {session ? "进入创作中心" : "免费开始创作"}
            </Link>
            <Link
              href="/explore"
              className="px-8 py-4 font-semibold rounded-3xl border border-white/15 hover:bg-white/5 transition-colors"
            >
              先逛逛作品
            </Link>
          </div>
        </div>
      </section>

      {/* 精选作品条带 */}
      {works.length > 0 && (
        <section className="max-w-7xl mx-auto px-6 pb-24">
          <div className="flex items-end justify-between mb-6">
            <h2 className="text-2xl font-bold tracking-tight">社区精选</h2>
            <Link href="/explore" className="text-sm text-rose-400 hover:text-rose-300">
              查看全部 <i className="fas fa-arrow-right ml-1" />
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {works.map((w) => (
              <Link
                key={w.id}
                href={`/explore/${w.id}`}
                className="result-card group relative rounded-3xl overflow-hidden border border-white/10 bg-[#111] aspect-[3/4]"
              >
                <WorkMedia
                  mode={w.mode}
                  src={w.thumbUrl ?? w.mediaUrl}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/90 to-transparent">
                  <p className="text-xs text-gray-300 line-clamp-2">{w.title ?? w.prompt}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <footer className="border-t border-white/10 py-8 text-center text-xs text-gray-500">
        AVClubs • 仅限 18 岁以上用户 • AI 生成内容
      </footer>
    </div>
  );
}
