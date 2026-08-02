import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { GuestHeader } from "@/components/GuestHeader";
import { ExploreGallery, type ExploreWork } from "@/components/ExploreGallery";
import { getCurrentUser } from "@/lib/auth";
import { hasAdultAccess } from "@/lib/adult-access";
import { publicWorkOut } from "@/lib/serialize";
import { getTranslations } from "next-intl/server";

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
const MODES = ["txt2img", "txt2vid", "img2img", "img2vid", "undress"] as const;

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

  const where = {
    isPublished: true,
    ...(!adultAccess ? { isAdult: false } : {}),
    ...(mode ? { mode } : {}),
  };
  const [total, works] = await Promise.all([
    db.publicWork.count({ where }),
    db.publicWork.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="min-h-screen">
      <GuestHeader />
      <div className="max-w-7xl mx-auto px-6 pt-10 pb-16">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="text-4xl font-bold tracking-tighter">{t("title")}</h1>
            <p className="text-gray-400 mt-1">{t("subtitle")}</p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/explore"
              className={`px-4 py-2 text-sm rounded-2xl border ${
                !mode ? "bg-orange-600 border-orange-600 text-white" : "border-white/10 text-gray-300 hover:bg-white/5"
              }`}
            >
              {t("all")}
            </Link>
            {MODES.map((key) => (
              <Link
                key={key}
                href={`/explore?mode=${key}`}
                className={`px-4 py-2 text-sm rounded-2xl border ${
                  mode === key
                    ? "bg-orange-600 border-orange-600 text-white"
                    : "border-white/10 text-gray-300 hover:bg-white/5"
                }`}
              >
                {t(`modes.${key}`)}
              </Link>
            ))}
          </div>
        </div>

        {works.length === 0 ? (
          <div className="glass rounded-3xl p-16 text-center text-gray-400">
            <i className="fas fa-images text-4xl mb-4 block text-gray-600" />
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
                className="px-5 py-2 border border-white/10 rounded-2xl hover:bg-white/5"
              >
                {t("previous")}
              </Link>
            )}
            <span className="px-5 py-2 text-gray-400">
              {page} / {totalPages}
            </span>
            {page < totalPages && (
              <Link
                href={`/explore?page=${page + 1}${mode ? `&mode=${mode}` : ""}`}
                className="px-5 py-2 border border-white/10 rounded-2xl hover:bg-white/5"
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
