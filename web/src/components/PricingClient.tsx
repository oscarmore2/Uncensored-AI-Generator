"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { api, type CatalogPackage, type CatalogVipPlan } from "@/lib/client";
import { useTranslations } from "next-intl";

/**
 * 卡片布局按数量自适应（Tailwind 需要静态类名，所以用查表而非拼接）：
 *   ≤3 个 —— 单行横排，每张卡片拉宽，内部改成左右布局（点数 / 价格分列）
 *    4 个 —— 2×2，卡片更大、字号更大
 *   ≥5 个 —— 一行最多三个，自动换行，末行居中（用 flex 而非 grid 才能居中孤行）
 */
type CardLayout = "row" | "quad" | "grid";

function cardLayoutFor(count: number): CardLayout {
  if (count <= 3) return "row";
  if (count === 4) return "quad";
  return "grid";
}

const LAYOUT_CONTAINER: Record<CardLayout, string> = {
  row: "flex flex-wrap justify-center gap-4",
  quad: "mx-auto flex max-w-4xl flex-wrap justify-center gap-5",
  grid: "flex flex-wrap justify-center gap-4",
};

const LAYOUT_ITEM: Record<CardLayout, string> = {
  // 上限避免只有 1~2 档时卡片被 flex-1 拉成满屏宽
  row: "basis-full sm:min-w-[17rem] sm:max-w-[26rem] sm:flex-1",
  quad: "basis-full sm:basis-[calc(50%-0.625rem)]",
  grid: "basis-full sm:basis-[calc(50%-0.5rem)] lg:basis-[calc(33.333%-0.667rem)]",
};

const LAYOUT_PADDING: Record<CardLayout, string> = {
  row: "p-7",
  quad: "p-8",
  grid: "p-6",
};

export function PricingClient({
  packages,
  vipPlans,
  signedIn,
  initialTab,
}: {
  packages: CatalogPackage[];
  vipPlans: CatalogVipPlan[];
  signedIn: boolean;
  initialTab: "credits" | "vip";
}) {
  const t = useTranslations("Pricing");
  const router = useRouter();
  const [tab, setTab] = useState<"credits" | "vip">(initialTab);
  const [selected, setSelected] = useState(
    (packages.find((item) => item.badge) ?? packages[0])?.credits ?? null
  );
  const [busy, setBusy] = useState<number | string | null>(null);
  const [message, setMessage] = useState("");
  const selectedPackage = useMemo(
    () => packages.find((item) => item.credits === selected),
    [packages, selected]
  );
  const pkgLayout = cardLayoutFor(packages.length);
  const vipLayout = cardLayoutFor(vipPlans.length);

  function requireLogin(next = "/pricing") {
    if (signedIn) return true;
    router.push(`/login?mode=register&next=${encodeURIComponent(next)}`);
    return false;
  }

  async function buyCredits(method: "card" | "crypto") {
    if (!selectedPackage || !requireLogin("/pricing") || busy) return;
    setBusy(method);
    setMessage("");
    try {
      if (method === "card") {
        const data = await api<{ demo?: boolean; message?: string; checkout_url?: string }>(
          "/api/payments/create-checkout",
          { method: "POST", body: JSON.stringify({ package: String(selectedPackage.credits) }) }
        );
        if (data.checkout_url) window.location.href = data.checkout_url;
        else if (data.demo) {
          setMessage(data.message ?? t("creditsReceived"));
          router.push("/make");
        }
      } else {
        const data = await api<{ checkout_url: string }>("/api/payments/crypto/create", {
          method: "POST",
          body: JSON.stringify({ package: String(selectedPackage.credits) }),
        });
        window.location.href = data.checkout_url;
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("paymentFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function buyVip(plan: CatalogVipPlan) {
    if (!requireLogin("/pricing?tab=vip") || busy) return;
    setBusy(plan.id);
    setMessage("");
    try {
      const data = await api<{ message?: string; checkout_url?: string }>(
        "/api/payments/subscribe-vip",
        { method: "POST", body: JSON.stringify({ plan_id: plan.id }) }
      );
      if (data.checkout_url) window.location.href = data.checkout_url;
      else {
        setMessage(data.message ?? t("vipActivated"));
        router.push("/profile");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("vipFailed"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="mx-auto mb-8 grid max-w-md grid-cols-2 rounded-2xl border border-line bg-black/[0.04] p-1">
        <button
          type="button"
          onClick={() => setTab("credits")}
          className={`rounded-xl px-5 py-3 text-sm font-semibold ${tab === "credits" ? "bg-teal-700 text-white" : "text-ink-muted"}`}
        >
          {t("creditsTab")}
        </button>
        <button
          type="button"
          onClick={() => setTab("vip")}
          className={`rounded-xl px-5 py-3 text-sm font-semibold ${tab === "vip" ? "bg-amber-400 text-black" : "text-ink-muted"}`}
        >
          {t("vipTab")}
        </button>
      </div>

      {message && (
        <div className="mx-auto mb-6 max-w-2xl rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-center text-sm text-amber-800">
          {message}
        </div>
      )}

      {tab === "credits" ? (
        <div>
          <div className={LAYOUT_CONTAINER[pkgLayout]}>
            {packages.map((item) => {
              const active = selected === item.credits;
              const price = `$${(item.price_cents / 100).toFixed(2)}`;
              return (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => setSelected(item.credits)}
                  className={`relative rounded-3xl border text-left transition ${LAYOUT_ITEM[pkgLayout]} ${LAYOUT_PADDING[pkgLayout]} ${
                    active
                      ? "border-teal-400 bg-teal-500/10 ring-1 ring-teal-400"
                      : "border-line bg-black/[0.03] hover:border-line-strong"
                  }`}
                >
                  {item.badge && (
                    <span className="absolute right-4 top-4 rounded-full bg-teal-700 px-3 py-1 text-[10px] font-bold text-white">
                      {item.badge}
                    </span>
                  )}

                  {pkgLayout === "row" ? (
                    // 卡片被拉宽后，点数与价格分列左右，避免大片留白
                    <div className="flex items-end justify-between gap-4">
                      <div>
                        <div className="text-sm text-ink-muted">{item.label}</div>
                        <div className="mt-3 text-4xl font-black">
                          {item.credits}
                          <span className="ml-2 text-sm font-normal text-ink-subtle">{t("credits")}</span>
                        </div>
                      </div>
                      <div className="shrink-0 text-3xl font-bold">{price}</div>
                    </div>
                  ) : (
                    <>
                      <div className="text-sm text-ink-muted">{item.label}</div>
                      <div className={`mt-4 font-black ${pkgLayout === "quad" ? "text-5xl" : "text-4xl"}`}>
                        {item.credits}
                        <span className="ml-2 text-sm font-normal text-ink-subtle">{t("credits")}</span>
                      </div>
                      <div className={`mt-5 font-bold ${pkgLayout === "quad" ? "text-3xl" : "text-2xl"}`}>
                        {price}
                      </div>
                    </>
                  )}
                </button>
              );
            })}
          </div>
          <div className="mx-auto mt-8 grid max-w-2xl gap-3 sm:grid-cols-2">
            <button
              type="button"
              disabled={!selectedPackage || busy !== null}
              onClick={() => void buyCredits("card")}
              className="rounded-2xl bg-orange-700 py-3.5 font-bold text-white hover:bg-orange-700 disabled:opacity-40"
            >
              {busy === "card" ? t("processing") : signedIn ? t("card") : t("registerToBuy")}
            </button>
            <button
              type="button"
              disabled={!selectedPackage || busy !== null}
              onClick={() => void buyCredits("crypto")}
              className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 py-3.5 font-bold text-emerald-700 hover:bg-emerald-400/15 disabled:opacity-40"
            >
              {busy === "crypto" ? t("processing") : t("crypto")}
            </button>
          </div>
        </div>
      ) : (
        <div className={LAYOUT_CONTAINER[vipLayout]}>
          {vipPlans.map((plan) => (
            <article
              key={plan.id}
              className={`flex flex-col rounded-3xl border border-amber-400/20 bg-gradient-to-b from-amber-400/10 to-white/[0.025] ${LAYOUT_ITEM[vipLayout]} ${LAYOUT_PADDING[vipLayout]}`}
            >
              <i className="fas fa-crown text-2xl text-amber-800" />
              <h2 className="mt-4 text-2xl font-bold">{plan.label}</h2>
              <p className="mt-1 text-sm text-ink-muted">{plan.tier.name}</p>
              <div className="mt-6 text-4xl font-black">
                ${(plan.price_cents / 100).toFixed(2)}
                <span className="text-sm font-normal text-ink-subtle"> / {t("days", { days: plan.duration_days })}</span>
              </div>
              <ul className="my-6 flex-1 space-y-3 text-sm text-ink-muted">
                <li><i className="fas fa-check mr-2 text-amber-800" />{t("adultMode")}</li>
                {plan.tier.discount_percent > 0 && (
                  <li><i className="fas fa-check mr-2 text-amber-800" />{t("discount", { percent: plan.tier.discount_percent })}</li>
                )}
                {plan.bonus_credits > 0 && (
                  <li><i className="fas fa-check mr-2 text-amber-800" />{t("bonus", { credits: plan.bonus_credits })}</li>
                )}
              </ul>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void buyVip(plan)}
                className="rounded-2xl bg-amber-400 py-3 font-bold text-black hover:bg-amber-300 disabled:opacity-40"
              >
                {busy === plan.id ? t("processing") : signedIn ? t("select") : t("registerToSubscribe")}
              </button>
            </article>
          ))}
        </div>
      )}

      {(tab === "credits" ? packages : vipPlans).length === 0 && (
        <div className="rounded-3xl border border-line p-12 text-center text-ink-subtle">{t("empty")}</div>
      )}
    </div>
  );
}
