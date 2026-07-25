import type { Metadata } from "next";
import { GuestHeader } from "@/components/GuestHeader";
import { PricingClient } from "@/components/PricingClient";
import { getSession } from "@/lib/session";
import { listActiveCatalog } from "@/lib/pricing";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Pricing");
  return {
    title: t("metaTitle"),
    description: t("description"),
    alternates: { canonical: "/pricing" },
    openGraph: {
      type: "website",
      title: t("metaTitle"),
      description: t("description"),
      url: "/pricing",
      images: ["/opengraph-image"],
    },
  };
}

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const [session, catalog, params] = await Promise.all([
    getSession(),
    listActiveCatalog(),
    searchParams,
  ]);
  const t = await getTranslations("Pricing");

  return (
    <div className="min-h-screen">
      <GuestHeader />
      <main className="mx-auto max-w-7xl px-6 py-12">
        <div className="mb-10 text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-violet-300">{t("eyebrow")}</p>
          <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-5xl">{t("title")}</h1>
          <p className="mx-auto mt-4 max-w-2xl text-gray-400">
            {t("description")}
          </p>
        </div>
        <PricingClient
          packages={catalog.credit_packages}
          vipPlans={catalog.vip_plans}
          signedIn={Boolean(session)}
          initialTab={params.tab === "vip" ? "vip" : "credits"}
        />
      </main>
    </div>
  );
}
