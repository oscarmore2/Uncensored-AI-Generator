import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { GuestHeader } from "@/components/GuestHeader";
import { WorkMedia } from "@/components/WorkMedia";
import { BrandLogo } from "@/components/BrandLogo";
import { getTranslations } from "next-intl/server";
import { absoluteUrl, SITE_NAME, SITE_URL } from "@/lib/site";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Metadata");
  return {
    title: { absolute: t("title") },
    description: t("description"),
    alternates: { canonical: "/" },
    openGraph: {
      type: "website",
      title: t("title"),
      description: t("description"),
      url: "/",
      images: ["/opengraph-image"],
    },
  };
}

export default async function LandingPage() {
  const [t, metadata] = await Promise.all([
    getTranslations("Landing"),
    getTranslations("Metadata"),
  ]);
  const [session, works] = await Promise.all([
    getSession(),
    db.publicWork.findMany({
      where: { isPublished: true, isAdult: false },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      take: 8,
    }),
  ]);
  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: SITE_NAME,
      url: SITE_URL,
      description: metadata("description"),
      inLanguage: ["zh-CN", "en"],
    },
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: SITE_NAME,
      url: SITE_URL,
      description: metadata("description"),
      applicationCategory: "MultimediaApplication",
      operatingSystem: "Any",
      browserRequirements: "Requires JavaScript",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
        url: absoluteUrl("/pricing"),
      },
    },
  ];

  return (
    <div className="min-h-screen">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
      <GuestHeader />

      {/* Hero：品牌 + 一句卖点 + CTA，背景用玫红氛围光 */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[900px] h-[600px] rounded-full bg-rose-600/20 blur-[160px]" />
          <div className="absolute bottom-0 right-0 w-[500px] h-[400px] rounded-full bg-pink-800/10 blur-[120px]" />
        </div>

        <div className="relative max-w-7xl mx-auto px-6 pt-24 pb-20 text-center">
          <div className="mb-8 flex justify-center">
            <BrandLogo className="[&_span:last-child]:text-5xl md:[&_span:last-child]:text-7xl [&_span:first-child]:h-16 [&_span:first-child]:w-16" />
          </div>

          <h1 className="text-2xl md:text-4xl font-bold tracking-tight text-gray-100 max-w-3xl mx-auto">
            {t("headline")}
          </h1>
          <p className="mt-4 text-gray-400 max-w-xl mx-auto">
            {t("subheading")}
          </p>

          <div className="mt-10 flex items-center justify-center gap-x-4">
            <Link
              href={session ? "/make" : "/login?mode=register"}
              className="generate-btn px-10 py-4 text-white font-bold text-lg rounded-3xl shadow-xl active:scale-[0.985]"
            >
              {session ? t("enterStudio") : t("startFree")}
            </Link>
            <Link
              href="/explore"
              className="px-8 py-4 font-semibold rounded-3xl border border-white/15 hover:bg-white/5 transition-colors"
            >
              {t("browse")}
            </Link>
          </div>
        </div>
      </section>

      <section className="border-y border-white/10 bg-white/[0.02]">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-violet-300">
            {t("seoEyebrow")}
          </p>
          <h2 className="mt-3 max-w-3xl text-3xl font-black tracking-tight md:text-4xl">
            {t("seoTitle")}
          </h2>
          <p className="mt-4 max-w-3xl leading-7 text-gray-400">{t("seoDescription")}</p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(["textToImage", "textToVideo", "imageToVideo", "multiModel"] as const).map((key) => (
              <article key={key} className="glass rounded-3xl p-6">
                <h3 className="font-bold text-gray-100">{t(`seoCards.${key}.title`)}</h3>
                <p className="mt-2 text-sm leading-6 text-gray-400">{t(`seoCards.${key}.body`)}</p>
              </article>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap gap-4 text-sm font-semibold">
            <Link href="/explore" className="text-rose-300 hover:text-rose-200">
              {t("exploreLink")} <i className="fas fa-arrow-right ml-1" />
            </Link>
            <Link href="/pricing" className="text-violet-300 hover:text-violet-200">
              {t("pricingLink")} <i className="fas fa-arrow-right ml-1" />
            </Link>
          </div>
        </div>
      </section>

      {/* 精选作品条带 */}
      {works.length > 0 && (
        <section className="max-w-7xl mx-auto px-6 pb-24">
          <div className="flex items-end justify-between mb-6">
            <h2 className="text-2xl font-bold tracking-tight">{t("featured")}</h2>
            <Link href="/explore" className="text-sm text-rose-400 hover:text-rose-300">
              {t("viewAll")} <i className="fas fa-arrow-right ml-1" />
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
        <span>{t("footer")}</span>
        <span className="mx-2">·</span>
        <Link href="/terms" className="hover:text-gray-300">{t("terms")}</Link>
        <span className="mx-2">·</span>
        <Link href="/content-policy" className="hover:text-gray-300">{t("contentPolicy")}</Link>
        <span className="mx-2">·</span>
        <Link href="/privacy" className="hover:text-gray-300">{t("privacy")}</Link>
        <span className="mx-2">·</span>
        <Link href="/explore" className="hover:text-gray-300">{t("exploreLink")}</Link>
        <span className="mx-2">·</span>
        <Link href="/pricing" className="hover:text-gray-300">{t("pricingLink")}</Link>
      </footer>
    </div>
  );
}
