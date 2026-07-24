import type { Metadata } from "next";
import { GuestHeader } from "@/components/GuestHeader";
import { PricingClient } from "@/components/PricingClient";
import { getSession } from "@/lib/session";
import { listActiveCatalog } from "@/lib/pricing";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "价格与会员" };

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

  return (
    <div className="min-h-screen">
      <GuestHeader />
      <main className="mx-auto max-w-7xl px-6 py-12">
        <div className="mb-10 text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-violet-300">Pricing</p>
          <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-5xl">选择适合你的创作方案</h1>
          <p className="mx-auto mt-4 max-w-2xl text-gray-400">
            购买点数按需生成，或升级 VIP 获取会员折扣、专属功能与成人模式资格。
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
