import { NextResponse } from "next/server";
import {
  ensureUserCredits,
  listRecentCreditTransactions,
} from "@/lib/credits";
import { getAuthenticatedServerContext } from "@/lib/supabase/server";
import { getSystemModelPublicInfo } from "@/lib/system-model";
import type { BillingSnapshot } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const systemModel = getSystemModelPublicInfo();
  const auth = await getAuthenticatedServerContext();

  if (!auth) {
    const payload: BillingSnapshot = {
      systemModel,
      credits: null,
      recentTransactions: [],
    };
    return NextResponse.json(payload);
  }

  const [credits, recentTransactions] = await Promise.all([
    ensureUserCredits(auth.supabase, auth.user.id),
    listRecentCreditTransactions(auth.supabase, auth.user.id, 15),
  ]);

  const payload: BillingSnapshot = {
    systemModel,
    credits,
    recentTransactions,
  };

  return NextResponse.json(payload);
}
