"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useApp } from "./AppContext";
import { api } from "@/lib/client";

const NAV = [
  { href: "/make", label: "创作中心" },
  { href: "/history", label: "我的作品" },
  { href: "/profile", label: "个人中心" },
];

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, setRechargeOpen, toast } = useApp();
  const [mobileOpen, setMobileOpen] = useState(false);
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
  const navItems = [
    ...NAV.slice(0, 1),
    ...(plaything ? [{ href: "/plaything", label: "玩物专区" }] : []),
    ...NAV.slice(1),
    ...(isMod ? [{ href: "/mod", label: "审核台" }] : []),
    ...(isAdmin ? [{ href: "/admin", label: "管理端" }] : []),
  ];

  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    toast("已退出登录");
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-[#0a0a0a]/95 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/make" className="flex items-center gap-x-3">
          <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-rose-600 via-red-600 to-pink-700 flex items-center justify-center shadow-inner">
            <span className="font-black text-white text-2xl tracking-tighter">AV</span>
          </div>
          <div>
            <span className="font-bold text-2xl tracking-tight">AVClubs</span>
            <span className="text-[10px] text-rose-500 font-mono ml-1">SECURE</span>
          </div>
        </Link>

        <nav className="hidden md:flex items-center gap-x-1 text-sm">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item px-5 py-2 text-sm font-medium ${
                pathname === item.href ? "nav-active text-white" : "text-gray-300 hover:text-white"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-x-3">
          <div
            onClick={() => setRechargeOpen(true)}
            className="credit-display flex items-center gap-x-2 px-4 h-9 rounded-2xl cursor-pointer hover:border-rose-500/50 transition-colors"
          >
            <div className="flex items-center gap-x-1.5">
              <i className="fas fa-coins text-amber-400" />
              <span className="font-mono font-semibold text-lg stat-number">{user?.balance ?? "—"}</span>
            </div>
            <span className="text-xs text-gray-400">点数</span>
          </div>

          <Link href="/profile" className="flex items-center gap-x-2 cursor-pointer">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-rose-700 to-pink-900 border border-white/20 flex items-center justify-center text-xs font-bold uppercase">
              {user?.username.slice(0, 2) ?? "?"}
            </div>
            <div className="hidden md:block">
              <div className="text-sm font-medium">{user?.username ?? "未登录"}</div>
              <div className="text-[10px] text-emerald-400 -mt-0.5">{user ? "已登录" : ""}</div>
            </div>
          </Link>

          <button
            onClick={() => setRechargeOpen(true)}
            className="hidden md:flex items-center gap-x-2 px-4 h-9 text-sm font-semibold bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl transition-all active:scale-[0.985]"
          >
            <i className="fas fa-wallet" />
            <span>充值</span>
          </button>

          {user && (
            <button
              onClick={logout}
              className="hidden md:block px-3 h-9 text-xs text-gray-400 hover:text-white border border-white/10 rounded-2xl"
            >
              退出
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
        <div className="fixed inset-0 bg-black/90 z-[120] md:hidden flex flex-col p-6">
          <div className="flex justify-between mb-8">
            <span className="font-bold text-2xl">AVClubs</span>
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
              setRechargeOpen(true);
              setMobileOpen(false);
            }}
            className="mt-auto py-4 bg-white text-black font-bold rounded-3xl"
          >
            充值点数
          </button>
        </div>
      )}
    </header>
  );
}
