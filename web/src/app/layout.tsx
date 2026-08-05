import type { Metadata } from "next";
import { Inter, Noto_Sans_SC } from "next/font/google";
import { CookieConsent } from "@/components/CookieConsent";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { env } from "@/lib/env";
import { absoluteUrl, SITE_NAME, SITE_URL } from "@/lib/site";
import "./globals.css";

/*
 * 字体自托管，不从 fonts.googleapis.com 拉。
 *
 * 原来 globals.css 里是一条 @import，但本站 CSP 的 style-src 没放行 googleapis，
 * 于是这两个字体从上线起就没生效过，一直在用系统字体兜底。
 * 而单纯把域名加进 CSP 并不解决问题：fonts.googleapis.com 在中国大陆打不开，
 * 放行只会把「立即失败」换成「阻塞渲染直到超时」，对主力用户更糟。
 * next/font 在构建期下载并从本站提供，CSP 不用改，大陆也能拿到。
 */
const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "900"],
  variable: "--font-inter",
  display: "swap",
});

const notoSansSC = Noto_Sans_SC({
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
  variable: "--font-noto-sans-sc",
  display: "swap",
});

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
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  return (
    <html lang={locale} className={`${inter.variable} ${notoSansSC.variable}`}>
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
