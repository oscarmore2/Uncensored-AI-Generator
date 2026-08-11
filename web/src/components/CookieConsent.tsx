"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

const STORAGE_KEY = "wanwankewu_cookie_consent_v1";

export function CookieConsent() {
  const t = useTranslations("Cookie");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(!window.localStorage.getItem(STORAGE_KEY));
  }, []);

  function choose(value: "necessary" | "all") {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ value, savedAt: new Date().toISOString() })
    );
    setVisible(false);
  }

  if (!visible) return null;

  return (
    /*
     * 这条是深色底（bg-[#101014]），但里面用的 text-ink / text-ink-muted / border-line
     * 全是浅色主题的 token —— 深底压深字，「仅必要 Cookie」那个按钮在手机上几乎看不见。
     * 深色底上一律写死浅色，别用主题 token。
     *
     * 底部内边距吃安全区：iPhone 和微信内置浏览器底部有一条 home indicator，
     * 不加的话按钮会被压在指示条底下点不准。
     */
    <aside
      className="fixed inset-x-0 bottom-0 z-[200] border-t border-white/10 bg-[#101014]/95 px-4 pt-4 shadow-2xl backdrop-blur-xl sm:px-5"
      style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      role="dialog"
      aria-label={t("aria")}
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <p className="max-w-4xl text-xs leading-5 text-white/70 sm:text-sm sm:leading-6">
          {t("message")}{" "}
          <Link href="/privacy" className="text-teal-300 underline underline-offset-2">
            {t("policy")}
          </Link>
          。
        </p>
        {/*
          原来是 shrink-0：两个按钮加起来比 375px 还宽，撑破 fixed 容器，
          整页跟着横向滚动。窄屏改成各占一半、允许换行。
        */}
        <div className="flex gap-2 sm:shrink-0">
          <button
            type="button"
            onClick={() => choose("necessary")}
            className="flex-1 whitespace-nowrap rounded-xl border border-white/25 px-3 py-2 text-sm font-medium text-white hover:bg-white/10 sm:flex-none sm:px-4"
          >
            {t("necessary")}
          </button>
          <button
            type="button"
            onClick={() => choose("all")}
            className="flex-1 whitespace-nowrap rounded-xl bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-500 sm:flex-none sm:px-4"
          >
            {t("accept")}
          </button>
        </div>
      </div>
    </aside>
  );
}
