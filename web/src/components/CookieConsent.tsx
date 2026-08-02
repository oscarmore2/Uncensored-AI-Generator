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
    <aside
      className="fixed inset-x-0 bottom-0 z-[200] border-t border-white/15 bg-[#101014]/95 px-5 py-4 shadow-2xl backdrop-blur-xl"
      role="dialog"
      aria-label={t("aria")}
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-4xl text-sm leading-6 text-gray-300">
          {t("message")}{" "}
          <Link href="/privacy" className="text-teal-300 underline underline-offset-2">
            {t("policy")}
          </Link>
          。
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => choose("necessary")}
            className="rounded-xl border border-white/15 px-4 py-2 text-sm font-medium text-gray-200 hover:bg-white/5"
          >
            {t("necessary")}
          </button>
          <button
            type="button"
            onClick={() => choose("all")}
            className="rounded-xl bg-teal-500 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-400"
          >
            {t("accept")}
          </button>
        </div>
      </div>
    </aside>
  );
}
