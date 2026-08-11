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
    <label
      className={`inline-flex shrink-0 items-center gap-1 text-ink-muted ${compact ? "text-xs" : "text-sm"}`}
    >
      {/*
        图标在窄屏顶栏里纯占地方，选择框本身已经说明了这是语言。
        display 类必须挂在外层 span 上：Font Awesome 的 .fas 也声明 display，
        而它的样式表在 Tailwind 之后加载，同为单类选择器时后者胜出——
        把 hidden 直接写在 <i> 上是不生效的（实测 computed display 仍是 block）。
      */}
      <span className={compact ? "hidden sm:inline" : ""}>
        <i className="fas fa-language" aria-hidden />
      </span>
      <span className="sr-only">{t("label")}</span>
      <select
        value={locale}
        onChange={(event) => change(event.target.value as AppLocale)}
        aria-label={t("label")}
        className="rounded-lg border border-line bg-surface px-2 py-1 text-ink outline-none"
      >
        {/*
          select 的宽度由最宽的那个选项撑出来，「简体中文」在 375px 的顶栏里
          要掉 110px 左右。紧凑模式换成短名，展开后仍然一眼能认。
        */}
        <option value="zh-CN">{compact ? "中文" : "简体中文"}</option>
        <option value="en">{compact ? "EN" : "English"}</option>
      </select>
    </label>
  );
}
