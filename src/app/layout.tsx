import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Atoms · 智能体应用生成工作台",
  description:
    "通过智能体驱动的方式自动生成应用，并以可视化网页形式实时展示与交互。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="dark" suppressHydrationWarning>
      <body className="bg-zinc-50 text-zinc-900 dark:bg-[#09090b] dark:text-zinc-100 font-sans">
        {children}
      </body>
    </html>
  );
}
