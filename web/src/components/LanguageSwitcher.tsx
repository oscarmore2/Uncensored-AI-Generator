"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { localeCookie, type AppLocale } from "@/i18n/config";

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const locale = useLocale() as AppLocale;
  const t = useTranslations("Language");
  const router = useRouter();

  function change(next: AppLocale) {
    if (next === locale) return;
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${localeCookie}=${encodeURIComponent(next)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    document.documentElement.lang = next;
    router.refresh();
  }

  return (
    <label className={`inline-flex items-center gap-1 text-gray-400 ${compact ? "text-xs" : "text-sm"}`}>
      <i className="fas fa-language" aria-hidden />
      <span className="sr-only">{t("label")}</span>
      <select
        value={locale}
        onChange={(event) => change(event.target.value as AppLocale)}
        aria-label={t("label")}
        className="rounded-lg border border-white/10 bg-[#111] px-2 py-1 text-gray-200 outline-none"
      >
        <option value="zh-CN">简体中文</option>
        <option value="en">English</option>
      </select>
    </label>
  );
}
