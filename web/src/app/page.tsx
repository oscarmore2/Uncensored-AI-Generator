import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { promptExcerpt } from "@/lib/serialize";
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

      {/* Hero：品牌 + 广告语 + CTA，背景用暖橘氛围光 */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[900px] h-[600px] rounded-full bg-orange-400/15 blur-[180px]" />
          <div className="absolute bottom-0 right-0 w-[500px] h-[400px] rounded-full bg-amber-300/15 blur-[140px]" />
        </div>

        <div className="relative max-w-7xl mx-auto px-6 pt-24 pb-20 text-center">
          <div className="mb-8 flex justify-center">
            <BrandLogo className="[&_span:last-child]:text-5xl md:[&_span:last-child]:text-7xl [&_span:first-child]:h-16 [&_span:first-child]:w-16" />
          </div>

          <h1 className="text-4xl md:text-6xl font-black tracking-tight text-ink">
            {t("tagline")}
          </h1>
          <p className="mt-5 text-lg md:text-xl font-medium text-ink-muted max-w-3xl mx-auto">
            {t("headline")}
          </p>
          <p className="mt-3 text-ink-subtle max-w-xl mx-auto">
            {t("subheading")}
          </p>

          {/* 窄屏两个按钮各自换行成两行（Enter/studio），改成上下排布、各占满一行 */}
          <div className="mt-10 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center sm:gap-x-4">
            <Link
              href={session ? "/make" : "/login?mode=register"}
              className="generate-btn rounded-3xl px-6 py-4 text-center text-lg font-bold text-ink shadow-xl active:scale-[0.985] sm:px-10"
            >
              {session ? t("enterStudio") : t("startFree")}
            </Link>
            <Link
              href="/explore"
              className="rounded-3xl border border-line px-6 py-4 text-center font-semibold transition-colors hover:bg-black/[0.04] sm:px-8"
            >
              {t("browse")}
            </Link>
          </div>
        </div>
      </section>

      <section className="border-y border-line bg-black/[0.03]">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-teal-700">
            {t("seoEyebrow")}
          </p>
          <h2 className="mt-3 max-w-3xl text-3xl font-black tracking-tight md:text-4xl">
            {t("seoTitle")}
          </h2>
          <p className="mt-4 max-w-3xl leading-7 text-ink-muted">{t("seoDescription")}</p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(["textToImage", "textToVideo", "imageToVideo", "multiModel"] as const).map((key) => (
              <article key={key} className="glass rounded-3xl p-6">
                <h3 className="font-bold text-ink">{t(`seoCards.${key}.title`)}</h3>
                <p className="mt-2 text-sm leading-6 text-ink-muted">{t(`seoCards.${key}.body`)}</p>
              </article>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap gap-4 text-sm font-semibold">
            <Link href="/explore" className="text-orange-700 hover:text-orange-800">
              {t("exploreLink")} <i className="fas fa-arrow-right ml-1" />
            </Link>
            <Link href="/pricing" className="text-teal-700 hover:text-teal-800">
              {t("pricingLink")} <i className="fas fa-arrow-right ml-1" />
            </Link>
          </div>
        </div>
      </section>

      {/* 关于：平台理念，兼作关于页正文 */}
      <section className="mx-auto max-w-7xl px-6 py-20">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-orange-700">
          {t("aboutEyebrow")}
        </p>
        <h2 className="mt-3 max-w-3xl text-3xl font-black tracking-tight md:text-4xl">
          {t("aboutTitle")}
        </h2>
        <div className="mt-6 max-w-3xl space-y-4 leading-8 text-ink-muted">
          <p>{t("aboutBody1")}</p>
          <p>{t("aboutBody2")}</p>
          <p>{t("aboutBody3")}</p>
        </div>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(["imagine", "simple", "fresh", "clear"] as const).map((key) => (
            <article
              key={key}
              className="rounded-3xl border border-line bg-black/[0.03] p-6 transition-colors hover:border-orange-500/30"
            >
              <h3 className="font-bold text-ink">{t(`values.${key}.title`)}</h3>
              <p className="mt-2 text-sm leading-6 text-ink-muted">{t(`values.${key}.body`)}</p>
            </article>
          ))}
        </div>
      </section>

      {/* 精选作品条带 */}
      {works.length > 0 && (
        <section className="max-w-7xl mx-auto px-6 pb-24">
          <div className="flex items-end justify-between mb-6">
            <h2 className="text-2xl font-bold tracking-tight">{t("featured")}</h2>
            <Link href="/explore" className="text-sm text-orange-700 hover:text-orange-800">
              {t("viewAll")} <i className="fas fa-arrow-right ml-1" />
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {works.map((w) => (
              <Link
                key={w.id}
                href={`/explore/${w.id}`}
                className="result-card group relative rounded-3xl overflow-hidden border border-line bg-surface aspect-[3/4]"
              >
                <WorkMedia
                  mode={w.mode}
                  src={w.thumbUrl ?? w.mediaUrl}
                  asThumbnail
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 px-4 pb-4 pt-10 bg-gradient-to-t from-black/95 via-black/55 to-transparent">
                  {/* 卡片说明最多也就两行，这里发完整提示词只是白白泄露给游客 */}
                  <p className="text-on-media text-xs font-medium line-clamp-2">
                    {w.title ?? promptExcerpt(w.prompt)}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <footer className="border-t border-line py-8 text-center text-xs text-ink-subtle">
        <span>{t("footer")}</span>
        <span className="mx-2">·</span>
        <Link href="/terms" className="hover:text-ink-muted">{t("terms")}</Link>
        <span className="mx-2">·</span>
        <Link href="/content-policy" className="hover:text-ink-muted">{t("contentPolicy")}</Link>
        <span className="mx-2">·</span>
        <Link href="/privacy" className="hover:text-ink-muted">{t("privacy")}</Link>
        <span className="mx-2">·</span>
        <Link href="/explore" className="hover:text-ink-muted">{t("exploreLink")}</Link>
        <span className="mx-2">·</span>
        <Link href="/pricing" className="hover:text-ink-muted">{t("pricingLink")}</Link>
      </footer>
    </div>
  );
}
