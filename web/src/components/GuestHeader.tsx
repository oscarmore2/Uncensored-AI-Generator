import Link from "next/link";
import { getSession } from "@/lib/session";

/** 游客侧导航：未登录显示登录/注册，已登录显示进入创作中心 */
export async function GuestHeader() {
  const session = await getSession();
  const isMod = session && (session.role === "moderator" || session.role === "admin");

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-[#0a0a0a]/95 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-x-3">
          <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-rose-600 via-red-600 to-pink-700 flex items-center justify-center shadow-inner">
            <span className="font-black text-white text-2xl tracking-tighter">AV</span>
          </div>
          <span className="font-bold text-2xl tracking-tight">AVClubs</span>
        </Link>

        <nav className="flex items-center gap-x-2 text-sm">
          <Link href="/explore" className="px-4 py-2 text-gray-300 hover:text-white font-medium">
            探索作品
          </Link>
          {isMod && (
            <Link href="/mod" className="px-4 py-2 text-amber-300 hover:text-amber-200 font-medium">
              审核台
            </Link>
          )}
          {session?.role === "admin" && (
            <Link href="/admin" className="px-4 py-2 text-rose-300 hover:text-rose-200 font-medium">
              管理端
            </Link>
          )}
          {session ? (
            <Link
              href="/make"
              className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white font-semibold rounded-2xl transition-colors"
            >
              去创作
            </Link>
          ) : (
            <>
              <Link href="/login" className="px-4 py-2 text-gray-300 hover:text-white font-medium">
                登录
              </Link>
              <Link
                href="/login?mode=register"
                className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white font-semibold rounded-2xl transition-colors"
              >
                免费注册
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
