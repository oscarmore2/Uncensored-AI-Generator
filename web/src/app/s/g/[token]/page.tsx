import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getTranslations } from "next-intl/server";
import { SharePoster, ShareExpired, firstPromptLine } from "@/components/SharePoster";
import { absoluteUrl } from "@/lib/site";

/**
 * 私有作品的分享页。公开可访问，不需要登录。
 *
 * 按令牌查而不是按 id：生成记录默认私有，id 是连号的，用 id 当地址等于
 * 把所有人的作品都摆出来任人遍历。撤销分享就是把 shareToken 置空。
 */

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

async function load(token: string) {
  if (!token || token.length > 64) return null;
  return db.generation.findFirst({
    // isAdult 在这里再挡一次。发令牌时已经拒过成人作品，但作品可能是先分享、
    // 后被审核标成成人的——那一刻链接必须立刻失效。
    where: { shareToken: token, deletedAt: null, isAdult: false, status: "succeeded" },
    select: {
      mode: true,
      prompt: true,
      resultUrls: true,
      mediaDeletedAt: true,
    },
  });
}

function urlsOf(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { token } = await params;
  const gen = await load(token);
  const t = await getTranslations("Share");
  // 分享页不进搜索索引：它是发给具体某个人的链接，不该被搜出来
  const robots = { index: false, follow: false } as const;
  if (!gen) return { title: t("expiredTitle"), robots };

  const urls = urlsOf(gen.resultUrls);
  const line = firstPromptLine(gen.prompt, 60);
  return {
    title: t("metaTitle"),
    description: line || t("metaDescription"),
    robots,
    openGraph: {
      title: t("metaTitle"),
      description: line || t("metaDescription"),
      url: absoluteUrl(`/s/g/${token}`),
      images: gen.mediaDeletedAt || !urls[0] ? undefined : [urls[0]],
      type: "article",
    },
  };
}

export default async function GenerationSharePage({ params }: Params) {
  const { token } = await params;
  const gen = await load(token);
  if (!gen) notFound();

  const urls = urlsOf(gen.resultUrls);
  if (gen.mediaDeletedAt || urls.length === 0) return <ShareExpired />;

  return <SharePoster mode={gen.mode} urls={urls} promptLine={firstPromptLine(gen.prompt)} />;
}
