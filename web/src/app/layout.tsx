import type { Metadata } from "next";
import { CookieConsent } from "@/components/CookieConsent";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "玩玩可物 • AI 媒体创作平台",
    template: "%s • 玩玩可物",
  },
  description: "用 AI 创作图片与视频，让灵感快速成为作品。",
  robots: { index: true, follow: true },
  // Cryptomus 域名验证（管理后台「在网站上使用元标记」）
  other: {
    cryptomus: "bb91b7a9",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css"
        />
      </head>
      <body className="min-h-screen antialiased">
        {children}
        <CookieConsent />
      </body>
    </html>
  );
}
