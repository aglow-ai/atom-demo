import type { SupabaseClient } from "@supabase/supabase-js";
import type { CreditTransactionItem, UserCreditsInfo } from "./types";

interface EnsureCreditsRpcRow {
  user_id: string;
  balance: number;
  total_granted: number;
  total_spent: number;
}

interface DeductCreditsRpcRow {
  charged: number;
  balance: number;
  total_spent: number;
  already_charged: boolean;
}

interface CreditTransactionDbRow {
  id: string;
  delta: number;
  balance_after: number;
  reason: string;
  project_id: string | null;
  job_id: string | null;
  model: string | null;
  input_tokens: number;
  cached_input_tokens?: number;
  cache_write_tokens?: number;
  output_tokens: number;
  created_at: string;
}

export async function ensureUserCredits(
  supabase: SupabaseClient,
  userId: string
): Promise<UserCreditsInfo | null> {
  // Fast path: read directly from user_credits (populated by auth.users signup trigger)
  const { data: existing, error: selectError } = await supabase
    .from("user_credits")
    .select("user_id, balance, total_granted, total_spent")
    .eq("user_id", userId)
    .maybeSingle();

  if (!selectError && existing) {
    const row = existing as EnsureCreditsRpcRow;
    return {
      balance: Number(row.balance) || 0,
      totalGranted: Number(row.total_granted) || 0,
      totalSpent: Number(row.total_spent) || 0,
    };
  }

  // Fallback: lazily initialize via SECURITY DEFINER RPC for pre-existing users
  const { data, error } = await supabase.rpc("ensure_user_credits", {
    p_user_id: userId,
  });

  if (error) {
    console.error("[credits] ensure_user_credits failed:", error.message);
    return null;
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | EnsureCreditsRpcRow
    | undefined;
  if (!row) return null;

  return {
    balance: Number(row.balance) || 0,
    totalGranted: Number(row.total_granted) || 0,
    totalSpent: Number(row.total_spent) || 0,
  };
}

export async function listRecentCreditTransactions(
  supabase: SupabaseClient,
  userId: string,
  limit = 15
): Promise<CreditTransactionItem[]> {
  const { data, error } = await supabase
    .from("credit_transactions")
    .select(
      "id, delta, balance_after, reason, project_id, job_id, model, input_tokens, cached_input_tokens, cache_write_tokens, output_tokens, created_at"
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !Array.isArray(data)) {
    return [];
  }

  return (data as CreditTransactionDbRow[]).map((row) => ({
    id: row.id,
    delta: Number(row.delta) || 0,
    balanceAfter: Number(row.balance_after) || 0,
    reason: row.reason,
    projectId: row.project_id ?? null,
    jobId: row.job_id ?? null,
    model: row.model ?? null,
    inputTokens: Number(row.input_tokens) || 0,
    cachedInputTokens: Number(row.cached_input_tokens) || 0,
    cacheWriteTokens: Number(row.cache_write_tokens) || 0,
    outputTokens: Number(row.output_tokens) || 0,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
  }));
}

export async function deductUserCredits(
  supabase: SupabaseClient,
  params: {
    userId: string;
    amount: number;
    projectId: string;
    jobId: string;
    model: string;
    inputTokens: number;
    cachedInputTokens?: number;
    cacheWriteTokens?: number;
    outputTokens: number;
  }
): Promise<{
  charged: number;
  balance: number;
  totalSpent: number;
  alreadyCharged: boolean;
} | null> {
  if (params.amount <= 0) {
    return null;
  }

  const { data, error } = await supabase.rpc("deduct_user_credits", {
    p_user_id: params.userId,
    p_amount: Math.floor(params.amount),
    p_project_id: params.projectId,
    p_job_id: params.jobId,
    p_model: params.model,
    p_input_tokens: Math.max(0, Math.floor(params.inputTokens)),
    p_output_tokens: Math.max(0, Math.floor(params.outputTokens)),
    p_cached_input_tokens: Math.max(
      0,
      Math.floor(params.cachedInputTokens ?? 0)
    ),
    p_cache_write_tokens: Math.max(
      0,
      Math.floor(params.cacheWriteTokens ?? 0)
    ),
  });

  if (error) {
    console.error("[credits] deduct_user_credits failed:", error.message);
    return null;
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | DeductCreditsRpcRow
    | undefined;
  if (!row) return null;

  return {
    charged: Number(row.charged) || 0,
    balance: Number(row.balance) || 0,
    totalSpent: Number(row.total_spent) || 0,
    alreadyCharged: Boolean(row.already_charged),
  };
}
