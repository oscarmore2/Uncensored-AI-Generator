import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { GuestHeader } from "@/components/GuestHeader";
import { ExploreGallery, type ExploreWork } from "@/components/ExploreGallery";
import { getCurrentUser } from "@/lib/auth";
import { hasAdultAccess } from "@/lib/adult-access";
import { publicWorkOut } from "@/lib/serialize";
import { getTranslations } from "next-intl/server";
import { GENERATION_MODES } from "@/lib/generation-modes";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Explore");
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: { canonical: "/explore" },
    openGraph: {
      type: "website",
      title: t("metaTitle"),
      description: t("metaDescription"),
      url: "/explore",
      images: ["/opengraph-image"],
    },
  };
}

const PAGE_SIZE = 24;
// 从模式定义派生：这里原先手抄了 5 个模式，视频转视频一族与 3D 的作品
// 在筛选条上根本点不到——每加一个模式都得回来补一次，抄一次就漏一次
const MODES = GENERATION_MODES;

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; mode?: string }>;
}) {
  const sp = await searchParams;
  const t = await getTranslations("Explore");
  const page = Math.max(1, Number(sp.page) || 1);
  const mode = sp.mode && MODES.includes(sp.mode as (typeof MODES)[number]) ? sp.mode : undefined;
  const user = await getCurrentUser();
  const adultAccess = hasAdultAccess(user);

  const visible = { isPublished: true, ...(!adultAccess ? { isAdult: false } : {}) };
  const where = { ...visible, ...(mode ? { mode } : {}) };
  const [total, works, published] = await Promise.all([
    db.publicWork.count({ where }),
    db.publicWork.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    // 只列真有作品的模式：十三个模式全平铺出来，多数点进去是一张空页
    db.publicWork.groupBy({ by: ["mode"], where: visible }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const availableModes = MODES.filter((m) => published.some((row) => row.mode === m));

  return (
    <div className="min-h-screen">
      <GuestHeader />
      <div className="max-w-7xl mx-auto px-6 pt-10 pb-16">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="text-4xl font-bold tracking-tighter">{t("title")}</h1>
            <p className="text-ink-muted mt-1">{t("subtitle")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/explore"
              className={`px-4 py-2 text-sm rounded-2xl border ${
                !mode ? "bg-orange-700 border-orange-700 text-white" : "border-line text-ink-muted hover:bg-black/[0.04]"
              }`}
            >
              {t("all")}
            </Link>
            {availableModes.map((key) => (
              <Link
                key={key}
                href={`/explore?mode=${key}`}
                className={`px-4 py-2 text-sm rounded-2xl border ${
                  mode === key
                    ? "bg-orange-700 border-orange-700 text-white"
                    : "border-line text-ink-muted hover:bg-black/[0.04]"
                }`}
              >
                {t(`modes.${key}`)}
              </Link>
            ))}
          </div>
        </div>

        {works.length === 0 ? (
          <div className="glass rounded-3xl p-16 text-center text-ink-muted">
            <i className="fas fa-images text-4xl mb-4 block text-ink-subtle" />
            {t("empty")}
          </div>
        ) : (
          <ExploreGallery
            signedIn={Boolean(user)}
            works={works.map((work) => ({
              ...publicWorkOut(work),
              created_at: work.createdAt.toISOString(),
            })) as ExploreWork[]}
          />
        )}

        {totalPages > 1 && (
          <div className="mt-10 flex justify-center gap-x-3 text-sm">
            {page > 1 && (
              <Link
                href={`/explore?page=${page - 1}${mode ? `&mode=${mode}` : ""}`}
                className="px-5 py-2 border border-line rounded-2xl hover:bg-black/[0.04]"
              >
                {t("previous")}
              </Link>
            )}
            <span className="px-5 py-2 text-ink-muted">
              {page} / {totalPages}
            </span>
            {page < totalPages && (
              <Link
                href={`/explore?page=${page + 1}${mode ? `&mode=${mode}` : ""}`}
                className="px-5 py-2 border border-line rounded-2xl hover:bg-black/[0.04]"
              >
                {t("next")}
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
