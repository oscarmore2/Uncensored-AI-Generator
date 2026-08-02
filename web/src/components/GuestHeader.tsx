import Link from "next/link";
import { getSession } from "@/lib/session";
import { BrandLogo } from "./BrandLogo";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { getTranslations } from "next-intl/server";

/** 游客侧导航：未登录显示登录/注册，已登录显示进入创作中心 */
export async function GuestHeader() {
  const t = await getTranslations("Header");
  const session = await getSession();
  const isMod = session && (session.role === "moderator" || session.role === "admin");

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-surface/95 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <BrandLogo compact />

        <nav className="flex items-center gap-x-2 text-sm">
          <Link href="/explore" className="px-4 py-2 text-ink-muted hover:text-ink font-medium">
            {t("explore")}
          </Link>
          <Link href="/pricing" className="hidden px-4 py-2 text-ink-muted hover:text-ink font-medium sm:block">
            {t("pricing")}
          </Link>
          {isMod && (
            <Link href="/mod" className="px-4 py-2 text-amber-800 hover:text-amber-900 font-medium">
              {t("moderation")}
            </Link>
          )}
          {session?.role === "admin" && (
            <Link href="/admin" className="px-4 py-2 text-orange-700 hover:text-orange-800 font-medium">
              {t("admin")}
            </Link>
          )}
          {session ? (
            <Link
              href="/make"
              className="px-5 py-2 bg-orange-700 hover:bg-orange-700 text-white font-semibold rounded-2xl transition-colors"
            >
              {t("goCreate")}
            </Link>
          ) : (
            <>
              <Link href="/login" className="px-4 py-2 text-ink-muted hover:text-ink font-medium">
                {t("login")}
              </Link>
              <Link
                href="/login?mode=register"
                className="px-5 py-2 bg-orange-700 hover:bg-orange-700 text-white font-semibold rounded-2xl transition-colors"
              >
                {t("register")}
              </Link>
            </>
          )}
          <LanguageSwitcher compact />
        </nav>
      </div>
    </header>
  );
}
