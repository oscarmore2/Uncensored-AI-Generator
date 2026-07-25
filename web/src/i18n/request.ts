import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { defaultLocale, isAppLocale, localeCookie, type AppLocale } from "./config";

function localeFromAcceptLanguage(value: string | null): AppLocale {
  if (!value) return defaultLocale;
  const requested = value
    .split(",")
    .map((part) => part.split(";")[0]?.trim().toLowerCase())
    .filter(Boolean);
  return requested.some((locale) => locale === "en" || locale.startsWith("en-"))
    ? "en"
    : defaultLocale;
}

export default getRequestConfig(async () => {
  const cookieLocale = (await cookies()).get(localeCookie)?.value;
  const locale = isAppLocale(cookieLocale)
    ? cookieLocale
    : localeFromAcceptLanguage((await headers()).get("accept-language"));
  const messages = (await import(`../../messages/${locale}.json`)).default;
  return { locale, messages };
});
