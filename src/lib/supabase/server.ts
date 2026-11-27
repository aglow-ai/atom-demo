import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getServerSupabaseEnv } from "./env";

export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const { url, publishableKey } = getServerSupabaseEnv();
  if (!url || !publishableKey) {
    throw new Error(
      "缺少 Supabase 环境变量：请配置 NEXT_PUBLIC_SUPABASE_URL 与 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY。"
    );
  }

  const cookieStore = await cookies();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component where mutating cookies is not allowed;
          // session refresh is handled by src/middleware.ts.
        }
      },
    },
  });
}

export interface AuthenticatedServerContext {
  supabase: SupabaseClient;
  user: User;
  /**
   * Returns a stateless Supabase client safe to use inside Next.js `after()`
   * background tasks after the HTTP request/cookie context has closed.
   */
  createBackgroundClient: () => Promise<SupabaseClient>;
}

export async function getAuthenticatedServerContext(): Promise<AuthenticatedServerContext | null> {
  const { url, publishableKey, serviceRoleKey } = getServerSupabaseEnv();
  if (!url || !publishableKey) return null;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  const createBackgroundClient = async (): Promise<SupabaseClient> => {
    if (serviceRoleKey) {
      return createClient(url, serviceRoleKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      });
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();

    const accessToken = session?.access_token;
    return createClient(url, publishableKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: accessToken
        ? {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        : undefined,
    });
  };

  return {
    supabase,
    user,
    createBackgroundClient,
  };
}
