import type { Metadata } from "next";
import { CookieConsent } from "@/components/CookieConsent";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { env } from "@/lib/env";
import { absoluteUrl, SITE_NAME, SITE_URL } from "@/lib/site";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Metadata");
  return {
    metadataBase: new URL(SITE_URL),
    applicationName: SITE_NAME,
    title: { default: t("title"), template: `%s • ${t("brand")}` },
    description: t("description"),
    keywords: [
      "AI image generator",
      "AI video generator",
      "text to image",
      "text to video",
      "image to video",
      "AI media generator",
      "AI 图片生成",
      "AI 视频生成",
      "文字生成图片",
      "图片生成视频",
    ],
    authors: [{ name: SITE_NAME, url: SITE_URL }],
    creator: SITE_NAME,
    publisher: SITE_NAME,
    category: "technology",
    formatDetection: { email: false, address: false, telephone: false },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
    },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title: t("title"),
      description: t("description"),
      url: SITE_URL,
      images: [{ url: absoluteUrl("/opengraph-image"), width: 1200, height: 630, alt: t("title") }],
    },
    twitter: {
      card: "summary_large_image",
      title: t("title"),
      description: t("description"),
      images: [absoluteUrl("/opengraph-image")],
    },
    appleWebApp: {
      capable: true,
      title: SITE_NAME,
      statusBarStyle: "black-translucent",
    },
    verification: env.GOOGLE_SITE_VERIFICATION
      ? { google: env.GOOGLE_SITE_VERIFICATION }
      : undefined,
    other: { cryptomus: "1b319f11" },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  return (
    <html lang={locale}>
      <head>
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css"
        />
      </head>
      <body className="min-h-screen antialiased">
        <NextIntlClientProvider messages={messages}>
          {children}
          <CookieConsent />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
