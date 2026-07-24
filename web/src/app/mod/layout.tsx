import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { BrandMark } from "@/components/BrandLogo";

const NAV = [
  { href: "/mod", label: "队列概览", icon: "fa-gauge" },
  { href: "/mod/generations", label: "作品审核", icon: "fa-clipboard-check" },
  { href: "/mod/users", label: "用户作品", icon: "fa-users" },
  { href: "/mod/public", label: "公共库", icon: "fa-globe" },
];

export default async function ModLayout({ children }: { children: React.ReactNode }) {
  // middleware 已按 JWT role 拦截，这里再按数据库 role 校验一次（防止改库后旧 JWT 越权）
  const mod = await requireRole("moderator", "admin");
  if (!mod) redirect("/");

  return (
    <div className="min-h-screen flex">
      <aside className="w-56 shrink-0 border-r border-white/10 bg-[#0d0d0d] flex flex-col">
        <Link href="/" className="flex items-center gap-x-2 px-5 h-16 border-b border-white/10">
          <BrandMark className="h-8 w-8 rounded-xl" />
          <div>
            <div className="font-bold leading-none">玩玩可物</div>
            <div className="text-[10px] text-amber-400 font-mono">MOD CONSOLE</div>
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
            <div className="text-gray-300 font-medium">{mod.username}</div>
            <div className="text-amber-400">{mod.role}</div>
          </div>
          {mod.role === "admin" && (
            <Link href="/admin" className="block text-rose-300 hover:text-rose-200">
              <i className="fas fa-chart-line mr-1" /> 管理端
            </Link>
          )}
          <Link href="/make" className="block text-gray-400 hover:text-white">
            <i className="fas fa-arrow-left mr-1" /> 返回创作端
          </Link>
        </div>
      </aside>

      <main className="flex-1 min-w-0 px-8 py-8">{children}</main>
    </div>
  );
}
