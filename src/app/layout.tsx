import type { Metadata } from "next";
import { AuthProvider, toAuthUser } from "@/components/AuthProvider";
import { BillingProvider } from "@/components/BillingProvider";
import {
  ensureUserCredits,
  listRecentCreditTransactions,
} from "@/lib/credits";
import { getAuthenticatedServerContext } from "@/lib/supabase/server";
import { getSystemModelPublicInfo } from "@/lib/system-model";
import type { BillingSnapshot } from "@/lib/types";
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
  const systemModel = getSystemModelPublicInfo();
  let initialBilling: BillingSnapshot = {
    systemModel,
    credits: null,
    recentTransactions: [],
  };

  try {
    const auth = await getAuthenticatedServerContext();
    initialUser = toAuthUser(auth?.user ?? null);

    if (auth) {
      const [credits, recentTransactions] = await Promise.all([
        ensureUserCredits(auth.supabase, auth.user.id),
        listRecentCreditTransactions(auth.supabase, auth.user.id, 15),
      ]);
      initialBilling = {
        systemModel,
        credits,
        recentTransactions,
      };
    }
  } catch {
    initialUser = null;
  }

  return (
    <html lang="zh-CN" className="dark" suppressHydrationWarning>
      <body className="bg-zinc-50 text-zinc-900 dark:bg-[#09090b] dark:text-zinc-100 font-sans">
        <AuthProvider initialUser={initialUser}>
          <BillingProvider initialBilling={initialBilling}>
            {children}
          </BillingProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
