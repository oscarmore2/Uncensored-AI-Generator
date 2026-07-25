export const locales = ["zh-CN", "en"] as const;
export type AppLocale = (typeof locales)[number];
export const defaultLocale: AppLocale = "zh-CN";
export const localeCookie = "ww_locale";

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && locales.includes(value as AppLocale);
}
