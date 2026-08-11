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
      {/*
        窄屏放不下五个导航项 + 语言切换：375px 上这一行原本要 498px，
        整站因此横向滚动（连带 fixed 定位的 Cookie 条也被撑宽）。
        次要入口（定价、审核台、管理端）收进 sm 以上，留下的项收紧内边距并禁止换行。
      */}
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-2 px-4 sm:px-6">
        <BrandLogo compact hideNameOnMobile />

        <nav className="flex min-w-0 items-center gap-x-0.5 text-sm sm:gap-x-2">
          <Link
            href="/explore"
            className="whitespace-nowrap px-2.5 py-2 font-medium text-ink-muted hover:text-ink sm:px-4"
          >
            {t("explore")}
          </Link>
          <Link
            href="/pricing"
            className="hidden whitespace-nowrap px-4 py-2 font-medium text-ink-muted hover:text-ink sm:block"
          >
            {t("pricing")}
          </Link>
          {/* 审核台 / 管理端是内部入口，手机上不值得占掉主行动的位置 */}
          {isMod && (
            <Link
              href="/mod"
              className="hidden whitespace-nowrap px-4 py-2 font-medium text-amber-800 hover:text-amber-900 sm:block"
            >
              {t("moderation")}
            </Link>
          )}
          {session?.role === "admin" && (
            <Link
              href="/admin"
              className="hidden whitespace-nowrap px-4 py-2 font-medium text-orange-700 hover:text-orange-800 sm:block"
            >
              {t("admin")}
            </Link>
          )}
          {session ? (
            <Link
              href="/make"
              className="whitespace-nowrap rounded-2xl bg-orange-700 px-3 py-2 font-semibold text-white transition-colors hover:bg-orange-700 sm:px-5"
            >
              {t("goCreate")}
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="whitespace-nowrap px-2.5 py-2 font-medium text-ink-muted hover:text-ink sm:px-4"
              >
                {t("login")}
              </Link>
              <Link
                href="/login?mode=register"
                className="whitespace-nowrap rounded-2xl bg-orange-700 px-3 py-2 font-semibold text-white transition-colors hover:bg-orange-700 sm:px-5"
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
