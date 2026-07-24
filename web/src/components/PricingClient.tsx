"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { api, type CatalogPackage, type CatalogVipPlan } from "@/lib/client";

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
          setMessage(data.message ?? "点数已到账");
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
      setMessage(error instanceof Error ? error.message : "创建付款失败");
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
        setMessage(data.message ?? "VIP 已开通");
        router.push("/profile");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "VIP 购买失败");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="mx-auto mb-8 grid max-w-md grid-cols-2 rounded-2xl border border-white/10 bg-black/30 p-1">
        <button
          type="button"
          onClick={() => setTab("credits")}
          className={`rounded-xl px-5 py-3 text-sm font-semibold ${tab === "credits" ? "bg-violet-500 text-white" : "text-gray-400"}`}
        >
          点数购买
        </button>
        <button
          type="button"
          onClick={() => setTab("vip")}
          className={`rounded-xl px-5 py-3 text-sm font-semibold ${tab === "vip" ? "bg-amber-400 text-black" : "text-gray-400"}`}
        >
          VIP 购买
        </button>
      </div>

      {message && (
        <div className="mx-auto mb-6 max-w-2xl rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-center text-sm text-amber-200">
          {message}
        </div>
      )}

      {tab === "credits" ? (
        <div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {packages.map((item) => {
              const active = selected === item.credits;
              return (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => setSelected(item.credits)}
                  className={`relative rounded-3xl border p-6 text-left transition ${
                    active ? "border-violet-400 bg-violet-500/10 ring-1 ring-violet-400" : "border-white/10 bg-white/[0.035] hover:border-white/25"
                  }`}
                >
                  {item.badge && (
                    <span className="absolute right-4 top-4 rounded-full bg-violet-500 px-3 py-1 text-[10px] font-bold text-white">
                      {item.badge}
                    </span>
                  )}
                  <div className="text-sm text-gray-400">{item.label}</div>
                  <div className="mt-4 text-4xl font-black">
                    {item.credits}
                    <span className="ml-2 text-sm font-normal text-gray-500">点数</span>
                  </div>
                  <div className="mt-5 text-2xl font-bold">${(item.price_cents / 100).toFixed(2)}</div>
                </button>
              );
            })}
          </div>
          <div className="mx-auto mt-8 grid max-w-2xl gap-3 sm:grid-cols-2">
            <button
              type="button"
              disabled={!selectedPackage || busy !== null}
              onClick={() => void buyCredits("card")}
              className="rounded-2xl bg-white py-3.5 font-bold text-black hover:bg-gray-100 disabled:opacity-40"
            >
              {busy === "card" ? "处理中…" : signedIn ? "银行卡购买" : "注册后购买"}
            </button>
            <button
              type="button"
              disabled={!selectedPackage || busy !== null}
              onClick={() => void buyCredits("crypto")}
              className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 py-3.5 font-bold text-emerald-300 hover:bg-emerald-400/15 disabled:opacity-40"
            >
              {busy === "crypto" ? "处理中…" : "加密货币购买"}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {vipPlans.map((plan) => (
            <article key={plan.id} className="flex flex-col rounded-3xl border border-amber-400/20 bg-gradient-to-b from-amber-400/10 to-white/[0.025] p-7">
              <i className="fas fa-crown text-2xl text-amber-300" />
              <h2 className="mt-4 text-2xl font-bold">{plan.label}</h2>
              <p className="mt-1 text-sm text-gray-400">{plan.tier.name}</p>
              <div className="mt-6 text-4xl font-black">
                ${(plan.price_cents / 100).toFixed(2)}
                <span className="text-sm font-normal text-gray-500"> / {plan.duration_days} 天</span>
              </div>
              <ul className="my-6 flex-1 space-y-3 text-sm text-gray-300">
                <li><i className="fas fa-check mr-2 text-amber-300" />可完成 18+ 年龄验证并开启成人模式</li>
                {plan.tier.discount_percent > 0 && (
                  <li><i className="fas fa-check mr-2 text-amber-300" />生成费用优惠 {plan.tier.discount_percent}%</li>
                )}
                {plan.bonus_credits > 0 && (
                  <li><i className="fas fa-check mr-2 text-amber-300" />赠送 {plan.bonus_credits} 点数</li>
                )}
              </ul>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void buyVip(plan)}
                className="rounded-2xl bg-amber-400 py-3 font-bold text-black hover:bg-amber-300 disabled:opacity-40"
              >
                {busy === plan.id ? "处理中…" : signedIn ? "选择此方案" : "注册后订阅"}
              </button>
            </article>
          ))}
        </div>
      )}

      {(tab === "credits" ? packages : vipPlans).length === 0 && (
        <div className="rounded-3xl border border-white/10 p-12 text-center text-gray-500">暂无可购买方案</div>
      )}
    </div>
  );
}
