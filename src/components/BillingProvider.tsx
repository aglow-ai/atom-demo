"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  BillingSnapshot,
  CreditTransactionItem,
  SystemModelPublicInfo,
  UserCreditsInfo,
} from "@/lib/types";
import { useAuth } from "./AuthProvider";

interface BillingContextValue {
  systemModel: SystemModelPublicInfo;
  credits: UserCreditsInfo | null;
  recentTransactions: CreditTransactionItem[];
  loading: boolean;
  refreshBilling: () => Promise<void>;
}

const BillingContext = createContext<BillingContextValue | null>(null);

export function BillingProvider({
  initialBilling,
  children,
}: {
  initialBilling: BillingSnapshot;
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const [systemModel, setSystemModel] = useState<SystemModelPublicInfo>(
    initialBilling.systemModel
  );
  const [credits, setCredits] = useState<UserCreditsInfo | null>(
    initialBilling.credits
  );
  const [recentTransactions, setRecentTransactions] = useState<
    CreditTransactionItem[]
  >(initialBilling.recentTransactions);
  const [loading, setLoading] = useState(false);

  const lastUserIdRef = useRef<string | null>(
    initialBilling.credits ? (user?.id ?? null) : null
  );

  const refreshBilling = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/account/billing", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as BillingSnapshot;
      if (data.systemModel) setSystemModel(data.systemModel);
      setCredits(data.credits ?? null);
      setRecentTransactions(
        Array.isArray(data.recentTransactions) ? data.recentTransactions : []
      );
    } catch {
      // ignore transient network errors
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const currentUserId = user?.id ?? null;
    if (currentUserId === lastUserIdRef.current) return;
    lastUserIdRef.current = currentUserId;

    if (!currentUserId) {
      setCredits(null);
      setRecentTransactions([]);
      return;
    }

    void refreshBilling();
  }, [user?.id, refreshBilling]);

  return (
    <BillingContext.Provider
      value={{
        systemModel,
        credits,
        recentTransactions,
        loading,
        refreshBilling,
      }}
    >
      {children}
    </BillingContext.Provider>
  );
}

export function useBilling(): BillingContextValue {
  const ctx = useContext(BillingContext);
  if (!ctx) {
    throw new Error("useBilling must be used within a BillingProvider");
  }
  return ctx;
}
