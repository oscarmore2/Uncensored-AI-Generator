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
  { href: "/admin/cryptomus", label: "Cryptomus", icon: "fa-key" },
  { href: "/admin/stripe", label: "Stripe", icon: "fa-credit-card" },
  { href: "/admin/zen", label: "Zen 账户", icon: "fa-wand-magic-sparkles" },
  { href: "/admin/hf", label: "Hugging Face", icon: "fa-brain" },
  { href: "/admin/wavespeed", label: "WaveSpeed", icon: "fa-puzzle-piece" },
  { href: "/admin/wavespeed/models", label: "玩物模型", icon: "fa-store" },
  { href: "/admin/pricing", label: "价格体系", icon: "fa-tags" },
  { href: "/admin/oss", label: "对象存储", icon: "fa-cloud" },
  { href: "/admin/media-cleanup", label: "媒体清理", icon: "fa-clock-rotate-left" },
  { href: "/admin/audit", label: "审计日志", icon: "fa-clipboard-list" },
  { href: "/admin/webhooks", label: "Webhook", icon: "fa-bolt" },
  { href: "/admin/settings", label: "系统配置", icon: "fa-gear" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // middleware 已按 JWT role 拦截，这里再按数据库 role 校验一次
  const admin = await requireRole("admin");
  if (!admin) redirect("/");

  return (
    <div className="min-h-screen flex">
      <aside className="w-56 shrink-0 border-r border-white/10 bg-[#0d0d0d] flex flex-col">
        <Link href="/" className="flex items-center gap-x-2 px-5 h-16 border-b border-white/10">
          <BrandMark className="h-8 w-8 rounded-xl" />
          <div>
            <div className="font-bold leading-none">玩玩可物</div>
            <div className="text-[10px] text-rose-400 font-mono">ADMIN CONSOLE</div>
          </div>
        </Link>

        <nav className="flex-1 p-3 space-y-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-x-3 px-4 py-2.5 text-sm text-gray-300 hover:text-white hover:bg-white/5 rounded-2xl"
            >
              <i className={`fas ${item.icon} w-4 text-center`} />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="p-4 border-t border-white/10 text-xs text-gray-500 space-y-2">
          <div>
            <div className="text-gray-300 font-medium">{admin.username}</div>
            <div className="text-rose-400">admin</div>
          </div>
          <Link href="/mod" className="block text-gray-400 hover:text-white">
            <i className="fas fa-clipboard-check mr-1" /> 审核台
          </Link>
          <Link href="/make" className="block text-gray-400 hover:text-white">
            <i className="fas fa-arrow-left mr-1" /> 返回创作端
          </Link>
        </div>
      </aside>

      <main className="flex-1 min-w-0 px-8 py-8">{children}</main>
    </div>
  );
}
