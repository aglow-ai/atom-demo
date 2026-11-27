"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { User } from "@supabase/supabase-js";
import { sanitizeNextPath } from "@/lib/auth-redirect";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export interface AuthUser {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
}

export function toAuthUser(user: User | null): AuthUser | null {
  if (!user) return null;
  const meta = (user.user_metadata || {}) as Record<string, unknown>;
  const name =
    (typeof meta.full_name === "string" && meta.full_name.trim()) ||
    (typeof meta.name === "string" && meta.name.trim()) ||
    (user.email ? user.email.split("@")[0] : null);
  const avatarUrl =
    (typeof meta.avatar_url === "string" && meta.avatar_url.trim()) ||
    (typeof meta.picture === "string" && meta.picture.trim()) ||
    null;

  return {
    id: user.id,
    email: user.email ?? null,
    name,
    avatarUrl,
  };
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  signInWithGoogle: (nextPath?: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  initialUser,
  children,
}: {
  initialUser: AuthUser | null;
  children: React.ReactNode;
}) {
  const [user, setUser] = useState<AuthUser | null>(initialUser);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    try {
      const supabase = getSupabaseBrowserClient();

      supabase.auth
        .getUser()
        .then(({ data }) => {
          if (active) {
            setUser(toAuthUser(data.user ?? null));
          }
        })
        .catch(() => {
          // Keep current state if transient network error occurs
        });

      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((_event, session) => {
        if (active) {
          setUser(toAuthUser(session?.user ?? null));
        }
      });
      unsubscribe = () => subscription.unsubscribe();
    } catch {
      // Missing env vars handled gracefully on sign-in call
    }

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const signInWithGoogle = useCallback(
    async (nextPath?: string): Promise<{ error?: string }> => {
      setLoading(true);
      try {
        const supabase = getSupabaseBrowserClient();
        const safeNext = sanitizeNextPath(nextPath);
        const redirectUrl = new URL("/auth/callback", window.location.origin);
        if (safeNext !== "/") {
          redirectUrl.searchParams.set("next", safeNext);
        }

        const { error } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: redirectUrl.toString(),
            queryParams: {
              prompt: "select_account",
            },
          },
        });

        if (error) {
          setLoading(false);
          return { error: error.message || "无法发起 Google 登录" };
        }
        return {};
      } catch (err) {
        setLoading(false);
        return {
          error: err instanceof Error ? err.message : "无法发起 Google 登录",
        };
      }
    },
    []
  );

  const signOut = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      await supabase.auth.signOut();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
