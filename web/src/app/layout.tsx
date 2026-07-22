import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AVClubs • AI 成人内容生成器",
  description: "AI 成人内容生成平台（Next.js 全栈版）",
  robots: { index: false, follow: false },
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
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
