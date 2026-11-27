import type { Metadata } from "next";
import { AuthProvider, toAuthUser } from "@/components/AuthProvider";
import { getAuthenticatedServerContext } from "@/lib/supabase/server";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Atoms · 智能体应用生成工作台",
  description:
    "通过智能体驱动的方式自动生成应用，并以可视化网页形式实时展示与交互。",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let initialUser = null;
  try {
    const auth = await getAuthenticatedServerContext();
    initialUser = toAuthUser(auth?.user ?? null);
  } catch {
    initialUser = null;
  }

  return (
    <html lang="zh-CN" className="dark" suppressHydrationWarning>
      <body className="bg-zinc-50 text-zinc-900 dark:bg-[#09090b] dark:text-zinc-100 font-sans">
        <AuthProvider initialUser={initialUser}>{children}</AuthProvider>
      </body>
    </html>
  );
}
