import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { BrandMark } from "@/components/BrandLogo";

const NAV = [
  { href: "/admin", label: "数据看板", icon: "fa-chart-line" },
  { href: "/admin/users", label: "用户管理", icon: "fa-user-gear" },
  { href: "/admin/mods", label: "审核员", icon: "fa-user-shield" },
  { href: "/admin/transactions", label: "交易流水", icon: "fa-receipt" },
  { href: "/admin/crypto", label: "加密订单", icon: "fa-coins" },
  { href: "/admin/nowpayments", label: "NOWPayments", icon: "fa-key" },
  { href: "/admin/stripe", label: "Stripe", icon: "fa-credit-card" },
  { href: "/admin/hf", label: "Hugging Face", icon: "fa-brain" },
  { href: "/admin/openai", label: "内容审查", icon: "fa-shield-halved" },
  { href: "/admin/wavespeed", label: "WaveSpeed", icon: "fa-puzzle-piece" },
  { href: "/admin/wavespeed/models", label: "玩物模型", icon: "fa-store" },
  { href: "/admin/pricing", label: "价格体系", icon: "fa-tags" },
  { href: "/admin/oss", label: "对象存储", icon: "fa-cloud" },
  { href: "/admin/media-cleanup", label: "媒体清理", icon: "fa-clock-rotate-left" },
  { href: "/admin/audit", label: "审计日志", icon: "fa-clipboard-list" },
  { href: "/admin/webhooks", label: "Webhook", icon: "fa-bolt" },
  { href: "/admin/settings", label: "系统配置", icon: "fa-gear" },
];

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // middleware 已按 JWT role 拦截，这里再按数据库 role 校验一次
  const admin = await requireRole("admin");
  if (!admin) redirect("/");

  return (
    <div className="min-h-screen flex">
      <aside className="w-56 shrink-0 border-r border-sidebar-line bg-sidebar text-sidebar-fg flex flex-col">
        <Link href="/" className="flex items-center gap-x-2 px-5 h-16 border-b border-sidebar-line">
          <BrandMark className="h-8 w-8 rounded-xl" />
          <div>
            <div className="font-bold leading-none">玩玩可物</div>
            <div className="text-[10px] text-orange-300 font-mono">ADMIN CONSOLE</div>
          </div>
        </Link>

        <nav className="flex-1 p-3 space-y-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-x-3 px-4 py-2.5 text-sm text-sidebar-fg-muted hover:text-sidebar-fg hover:bg-sidebar-line rounded-2xl transition-colors"
            >
              <i className={`fas ${item.icon} w-4 text-center`} />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="p-4 border-t border-sidebar-line text-xs text-sidebar-fg-subtle space-y-2">
          <div>
            <div className="text-sidebar-fg font-medium">{admin.username}</div>
            <div className="text-orange-300">admin</div>
          </div>
          <Link href="/mod" className="block text-sidebar-fg-muted hover:text-sidebar-fg">
            <i className="fas fa-clipboard-check mr-1" /> 审核台
          </Link>
          <Link href="/make" className="block text-sidebar-fg-muted hover:text-sidebar-fg">
            <i className="fas fa-arrow-left mr-1" /> 返回创作端
          </Link>
        </div>
      </aside>

      <main className="flex-1 min-w-0 px-8 py-8">{children}</main>
    </div>
  );
}
