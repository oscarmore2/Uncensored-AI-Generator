import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { hasAdultAccess } from "@/lib/adult-access";
import { GuestHeader } from "@/components/GuestHeader";
import { AdaptiveMedia } from "@/components/WorkMedia";
import { getTranslations } from "next-intl/server";
import { GENERATION_MODES } from "@/lib/generation-modes";

export const dynamic = "force-dynamic";

// 从模式定义派生：写死过一次，加了视频转视频与 3D 之后这里的角标就退回成了 model_id
const MODE_KEYS = new Set<string>(GENERATION_MODES);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const workId = Number(id);
  if (!Number.isInteger(workId)) {
    return { robots: { index: false, follow: false } };
  }

  const work = await db.publicWork.findUnique({
    where: { id: workId },
    select: {
      title: true,
      prompt: true,
      mediaUrl: true,
      thumbUrl: true,
      isPublished: true,
      isAdult: true,
    },
  });
  if (!work || !work.isPublished || work.isAdult) {
    return { robots: { index: false, follow: false, nocache: true } };
  }

  const t = await getTranslations("Explore");
  const title = work.title?.trim() || `${t("communityWork")} #${workId}`;
  const description = work.prompt.replace(/\s+/g, " ").trim().slice(0, 160);
  const image = work.thumbUrl ?? work.mediaUrl;
  return {
    title,
    description,
    alternates: { canonical: `/explore/${workId}` },
    openGraph: {
      type: "article",
      title,
      description,
      url: `/explore/${workId}`,
      images: [{ url: image, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}

export default async function WorkDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("Explore");
  const workId = Number(id);
  if (!Number.isInteger(workId)) notFound();

  const user = await getCurrentUser();
  const adultAccess = hasAdultAccess(user);
  const work = await db.publicWork.findFirst({
    where: {
      id: workId,
      isPublished: true,
      ...(!adultAccess ? { isAdult: false } : {}),
    },
  });
  if (!work) notFound();

  let paramEntries: [string, unknown][] = [];
  try {
    paramEntries = Object.entries(JSON.parse(work.params) as Record<string, unknown>);
  } catch {
    // params 非法 JSON 时不展示
  }

  // 同款参数创作：把 prompt/negative/mode 带进创作中心；未登录先走登录并回跳
  const makeUrl = `/make?remix_work=${work.id}`;
  const ctaHref = user ? makeUrl : `/login?mode=register&next=${encodeURIComponent(makeUrl)}`;

  return (
    <div className="min-h-screen">
      <GuestHeader />
      <div className="max-w-6xl mx-auto px-6 pt-8 pb-16">
        <Link href="/explore" className="text-sm text-ink-muted hover:text-ink">
          <i className="fas fa-arrow-left mr-2" />
          {t("back")}
        </Link>

        <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-7">
            <div className="rounded-3xl overflow-hidden border border-line bg-surface">
              <AdaptiveMedia mode={work.mode} src={work.mediaUrl} poster={work.thumbUrl} />
            </div>
          </div>

          <div className="lg:col-span-5 space-y-5">
            <div>
              <span className="media-badge">{MODE_KEYS.has(work.mode) ? t(`modes.${work.mode}` as "modes.txt2img") : work.mode}</span>
              {work.isAdult && (
                <span className="ml-2 rounded-full bg-red-700 px-2 py-0.5 text-[10px] font-bold text-white">18+</span>
              )}
              <h1 className="text-2xl font-bold tracking-tight mt-3">{work.title ?? t("communityWork")}</h1>
            </div>

            {/* 3D、超分这些模式的模型不收提示词，空着只会留一张空卡 */}
            {work.prompt.trim() && (
              <div className="glass rounded-3xl p-5">
                <div className="text-xs font-semibold text-ink-muted mb-2">{t("prompt")}</div>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{work.prompt}</p>
              </div>
            )}

            {work.negativePrompt && (
              <div className="glass rounded-3xl p-5">
                <div className="text-xs font-semibold text-ink-muted mb-2">{t("negativePrompt")}</div>
                <p className="text-sm text-ink-muted">{work.negativePrompt}</p>
              </div>
            )}

            {paramEntries.length > 0 && (
              <div className="glass rounded-3xl p-5">
                <div className="text-xs font-semibold text-ink-muted mb-3">{t("parameters")}</div>
                <div className="space-y-2 text-xs">
                  {paramEntries.map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-x-4">
                      <span className="text-ink-muted font-mono">{k}</span>
                      {/* media_fields 是对象，String() 会得到 [object Object] */}
                      <span className="font-mono text-right break-all">
                        {typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="pt-2">
              <Link
                href={ctaHref}
                className="generate-btn block w-full py-4 text-ink font-bold text-lg rounded-3xl text-center shadow-xl active:scale-[0.985]"
              >
                <i className="fas fa-magic mr-2" />
                {user ? t("createSame") : t("registerCreateSame")}
              </Link>
              {!user && (
                <p className="text-center text-xs text-ink-subtle mt-3">{t("signupHint")}</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
