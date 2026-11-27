"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, Atom, Loader2, ShieldCheck } from "lucide-react";
import { sanitizeNextPath } from "@/lib/auth-redirect";
import { loadTheme } from "@/lib/storage";
import { useAuth } from "./AuthProvider";
import { GoogleIcon } from "./GoogleIcon";

interface LoginPageProps {
  nextPath?: string;
  initialError?: string;
}

export function LoginPage({ nextPath, initialError }: LoginPageProps) {
  const { signInWithGoogle } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(initialError || null);

  const safeNext = sanitizeNextPath(nextPath);

  useEffect(() => {
    const savedTheme = loadTheme();
    document.documentElement.classList.toggle("dark", savedTheme === "dark");
  }, []);

  const handleGoogleLogin = async () => {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    const res = await signInWithGoogle(safeNext);
    if (res.error) {
      setError(res.error);
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-[#09090b] text-zinc-900 dark:text-zinc-100 flex flex-col">
      <header className="h-14 border-b border-zinc-200/80 dark:border-zinc-800/80 bg-white/80 dark:bg-[#09090b]/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto h-full px-4 sm:px-6 flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2.5 hover:opacity-90 transition-opacity"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-sm shadow-violet-500/20">
              <Atom className="h-4.5 w-4.5" />
            </div>
            <span className="font-semibold text-base tracking-tight">Atoms</span>
          </Link>

          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            返回首页
          </Link>
        </div>
      </header>

      <main className="relative flex-1 flex items-center justify-center overflow-hidden px-4 py-12">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 -top-24 h-96 bg-[radial-gradient(ellipse_at_top,rgba(124,58,237,0.20),transparent_68%)]"
        />

        <div className="relative w-full max-w-md rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111115] p-7 sm:p-8 shadow-2xl shadow-black/5 dark:shadow-black/40">
          <div className="flex flex-col items-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-lg shadow-violet-500/25">
              <Atom className="h-6 w-6" />
            </div>

            <h1 className="mt-4 text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              登录 Atoms
            </h1>
            <p className="mt-2 text-xs sm:text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
              使用 Google 账号登录后，即可创建、保存并管理你的专属云端网页应用项目。
            </p>
          </div>

          {error && (
            <div className="mt-5 flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-600 dark:text-rose-300">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span className="break-words">{error}</span>
            </div>
          )}

          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={submitting}
            className="mt-6 w-full inline-flex items-center justify-center gap-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:border-violet-500/50 disabled:opacity-60 disabled:cursor-not-allowed px-4 py-3 text-sm font-medium text-zinc-900 dark:text-zinc-100 shadow-sm transition-all"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-violet-500" />
                <span>正在跳转到 Google 登录...</span>
              </>
            ) : (
              <>
                <GoogleIcon className="h-4.5 w-4.5 shrink-0" />
                <span>使用 Google 账号继续</span>
              </>
            )}
          </button>

          <div className="mt-6 flex items-center justify-center gap-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
            <span>基于 Supabase Auth · 项目数据按个人账号行级隔离</span>
          </div>
        </div>
      </main>
    </div>
  );
}
