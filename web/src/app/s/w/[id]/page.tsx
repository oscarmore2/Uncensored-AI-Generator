import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getTranslations } from "next-intl/server";
import { SharePoster, firstPromptLine } from "@/components/SharePoster";
import { absoluteUrl } from "@/lib/site";

/**
 * 公共作品（explore 里那些）的分享页。
 *
 * 这里直接用 id：公共作品本来就人人可见，再套一层令牌只是徒增机关。
 * 精选作品不参与媒体清理，所以没有「已过期」这条分支。
 */

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function load(idRaw: string) {
  const id = Number(idRaw);
  if (!Number.isInteger(id)) return null;
  return db.publicWork.findFirst({
    // 成人作品不给分享页：这是公开地址，没有登录也没有年龄验证
    where: { id, isPublished: true, isAdult: false },
    select: { mode: true, prompt: true, mediaUrl: true, thumbUrl: true, title: true },
  });
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const work = await load(id);
  const t = await getTranslations("Share");
  const robots = { index: false, follow: false } as const;
  if (!work) return { title: t("expiredTitle"), robots };

  const line = work.title?.trim() || firstPromptLine(work.prompt, 60);
  return {
    title: t("metaTitle"),
    description: line || t("metaDescription"),
    robots,
    openGraph: {
      title: t("metaTitle"),
      description: line || t("metaDescription"),
      url: absoluteUrl(`/s/w/${id}`),
      images: [work.thumbUrl || work.mediaUrl],
      type: "article",
    },
  };
}

export default async function PublicWorkSharePage({ params }: Params) {
  const { id } = await params;
  const work = await load(id);
  if (!work) notFound();

  return (
    <SharePoster
      mode={work.mode}
      urls={[work.mediaUrl]}
      poster={work.thumbUrl}
      promptLine={firstPromptLine(work.prompt)}
    />
  );
}
