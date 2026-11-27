"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, FolderKanban, Loader2, LogOut } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { CreditsBadge } from "./CreditsBadge";
import { GoogleIcon } from "./GoogleIcon";

export function UserMenu() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading, signInWithGoogle, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setAvatarFailed(false);
  }, [user?.avatarUrl]);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  const handleSignIn = async () => {
    if (signingIn || loading) return;
    setSigningIn(true);
    const { error } = await signInWithGoogle(pathname || "/");
    if (error) {
      setSigningIn(false);
      router.push(`/login?error=${encodeURIComponent(error)}`);
    }
  };

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setOpen(false);
    try {
      await signOut();
      if (
        pathname === "/projects" ||
        pathname.startsWith("/projects/") ||
        pathname.startsWith("/project/")
      ) {
        router.replace("/");
      }
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  };

  if (!user) {
    return (
      <button
        type="button"
        onClick={handleSignIn}
        disabled={signingIn || loading}
        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-violet-500/50 hover:bg-zinc-50 dark:hover:bg-zinc-800/80 disabled:opacity-50 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-200 transition-colors"
      >
        {signingIn ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" />
        ) : (
          <GoogleIcon className="h-3.5 w-3.5 shrink-0" />
        )}
        <span>{signingIn ? "跳转中..." : "Google 登录"}</span>
      </button>
    );
  }

  const displayName = user.name || user.email || "Google 用户";
  const initial = displayName.trim().charAt(0).toUpperCase() || "U";

  return (
    <div className="flex items-center gap-2">
      <CreditsBadge />
      <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-violet-500/50 pl-1.5 pr-2 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-200 transition-colors"
        title={user.email || displayName}
      >
        {user.avatarUrl && !avatarFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.avatarUrl}
            alt={displayName}
            referrerPolicy="no-referrer"
            onError={() => setAvatarFailed(true)}
            className="h-5 w-5 rounded-full object-cover ring-1 ring-zinc-200 dark:ring-zinc-700"
          />
        ) : (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 text-[10px] font-semibold text-white">
            {initial}
          </span>
        )}
        <span className="hidden sm:inline max-w-[100px] truncate">
          {displayName}
        </span>
        <ChevronDown className="h-3 w-3 text-zinc-400" />
      </button>

      {open && (
        <div className="absolute right-0 mt-1.5 w-56 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#141418] shadow-xl p-1.5 z-50">
          <div className="px-2.5 py-2 border-b border-zinc-100 dark:border-zinc-800/80 mb-1">
            <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">
              {displayName}
            </div>
            {user.email && (
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
                {user.email}
              </div>
            )}
          </div>

          <Link
            href="/projects"
            onClick={() => setOpen(false)}
            className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <FolderKanban className="h-3.5 w-3.5 text-violet-500" />
            我的项目
          </Link>

          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 disabled:opacity-50 transition-colors"
          >
            {signingOut ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <LogOut className="h-3.5 w-3.5" />
            )}
            退出登录
          </button>
        </div>
      )}
      </div>
    </div>
  );
}
