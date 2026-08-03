"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useApp } from "./AppContext";
import { api } from "@/lib/client";
import { clearAllDrafts } from "@/lib/draft-store";
import { BrandLogo } from "./BrandLogo";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { useTranslations } from "next-intl";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";

export function Header() {
  const pathname = usePathname();
  const t = useTranslations("Header");
  const common = useTranslations("Common");
  const router = useRouter();
  const { user, toast } = useApp();
  const [mobileOpen, setMobileOpen] = useState(false);
  useBodyScrollLock(mobileOpen);
  const [plaything, setPlaything] = useState(false);

  useEffect(() => {
    if (!user) {
      setPlaything(false);
      return;
    }
    let cancelled = false;
    api<{ plaything?: boolean }>("/api/features")
      .then((f) => {
        if (!cancelled) setPlaything(Boolean(f.plaything));
      })
      .catch(() => {
        if (!cancelled) setPlaything(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const isMod = user?.role === "moderator" || user?.role === "admin";
  const isAdmin = user?.role === "admin";
  const nav = [
    { href: "/make", label: t("create") },
    { href: "/history", label: t("history") },
    { href: "/profile", label: t("profile") },
  ];
  const navItems = [
    ...nav.slice(0, 1),
    ...(plaything ? [{ href: "/plaything", label: t("plaything") }] : []),
    ...nav.slice(1),
    ...(isMod ? [{ href: "/mod", label: t("moderation") }] : []),
    ...(isAdmin ? [{ href: "/admin", label: t("admin") }] : []),
  ];

  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    // 未提交的提示词与参考图不留给下一个登录的人
    await clearAllDrafts().catch(() => {});
    toast(t("loggedOut"));
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-surface/95 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <BrandLogo href="/make" compact />

        <nav className="hidden md:flex items-center gap-x-1 text-sm">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item px-5 py-2 text-sm font-medium ${
                pathname === item.href ? "nav-active text-ink" : "text-ink-muted hover:text-ink"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-x-3">
          <div className="hidden lg:block">
            <LanguageSwitcher compact />
          </div>
          <div
            onClick={() => router.push("/pricing")}
            className="credit-display flex items-center gap-x-2 px-4 h-9 rounded-2xl cursor-pointer hover:border-orange-500/50 transition-colors"
          >
            <div className="flex items-center gap-x-1.5">
              <i className="fas fa-coins text-amber-800" />
              <span className="font-mono font-semibold text-lg stat-number">{user?.balance ?? "—"}</span>
            </div>
            <span className="text-xs text-ink-muted">{common("credits")}</span>
          </div>

          <Link href="/profile" className="flex items-center gap-x-2 cursor-pointer">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-600 to-amber-800 border border-line-strong flex items-center justify-center text-xs font-bold uppercase">
              {user?.username.slice(0, 2) ?? "?"}
            </div>
            <div className="hidden md:block">
              <div className="text-sm font-medium">{user?.username ?? t("notLoggedIn")}</div>
              <div className="text-[10px] text-emerald-700 -mt-0.5">{user ? t("loggedIn") : ""}</div>
            </div>
          </Link>

          <button
            onClick={() => router.push("/pricing")}
            className="hidden md:flex items-center gap-x-2 px-4 h-9 text-sm font-semibold bg-black/[0.03] hover:bg-black/[0.06] border border-line rounded-2xl transition-all active:scale-[0.985]"
          >
            <i className="fas fa-wallet" />
            <span>{t("recharge")}</span>
          </button>

          {user && (
            <button
              onClick={logout}
              className="hidden md:block px-3 h-9 text-xs text-ink-muted hover:text-ink border border-line rounded-2xl"
            >
              {t("logout")}
            </button>
          )}

          <button
            className="md:hidden w-9 h-9 flex items-center justify-center text-xl"
            onClick={() => setMobileOpen(true)}
          >
            <i className="fas fa-bars" />
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 scrim z-[120] md:hidden flex flex-col p-6">
          <div className="flex justify-between mb-8">
            <BrandLogo href="/make" compact />
            <button className="text-4xl" onClick={() => setMobileOpen(false)}>
              &times;
            </button>
          </div>
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className="py-4 text-lg"
            >
              {item.label}
            </Link>
          ))}
          <button
            onClick={() => {
              router.push("/pricing");
              setMobileOpen(false);
            }}
            className="mt-auto py-4 bg-orange-700 text-white font-bold rounded-3xl"
          >
            {t("rechargeCredits")}
          </button>
          <div className="pt-4">
            <LanguageSwitcher />
          </div>
        </div>
      )}
    </header>
  );
}
