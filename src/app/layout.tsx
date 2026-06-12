import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kreader · 轻小说阅读器",
  description:
    "Kreader（読）— 沉浸式日系轻小说阅读器。EPUB/TXT 导入，防剧透 AI，可插拔模型（QWEN / DeepSeek）。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased" data-theme="paper">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@400;500;600;700&family=Noto+Serif+SC:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
