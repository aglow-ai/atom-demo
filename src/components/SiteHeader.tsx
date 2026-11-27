"use client";

import React from "react";
import Link from "next/link";
import {
  Atom,
  FolderKanban,
  Moon,
  Settings,
  Sun,
} from "lucide-react";
import {
  getResolvedModelMode,
  isEffectiveModelReady,
  type ModelConfig,
} from "@/lib/types";
import { useBilling } from "./BillingProvider";
import { UserMenu } from "./UserMenu";

interface SiteHeaderProps {
  activeNav: "home" | "projects";
  projectCount?: number;
  modelConfig: ModelConfig;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  onOpenSettings: () => void;
}

export function SiteHeader({
  activeNav,
  projectCount,
  modelConfig,
  theme,
  onToggleTheme,
  onOpenSettings,
}: SiteHeaderProps) {
  const { systemModel } = useBilling();
  const mode = getResolvedModelMode(modelConfig);
  const isModelConfigured = isEffectiveModelReady(modelConfig, systemModel);
  const modelButtonLabel =
    mode === "system"
      ? systemModel.available
        ? `系统 · ${systemModel.model}`
        : "模型设置"
      : isModelConfigured
        ? modelConfig.model
        : "模型设置";

  return (
    <header className="sticky top-0 z-30 h-14 border-b border-zinc-200/80 dark:border-zinc-800/80 bg-white/80 dark:bg-[#09090b]/80 backdrop-blur-md">
      <div className="max-w-6xl mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-3">
        {/* Left: Brand + Primary Nav */}
        <div className="flex items-center gap-5">
          <Link
            href="/"
            className="flex items-center gap-2.5 hover:opacity-90 transition-opacity"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-sm shadow-violet-500/20">
              <Atom className="h-4.5 w-4.5" />
            </div>
            <span className="font-semibold text-base tracking-tight">Atoms</span>
          </Link>

          <nav className="flex items-center gap-1">
            <Link
              href="/projects"
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                activeNav === "projects"
                  ? "bg-zinc-900/5 dark:bg-white/10 text-zinc-900 dark:text-white"
                  : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
              }`}
            >
              <FolderKanban className="h-3.5 w-3.5" />
              我的项目
              {typeof projectCount === "number" && projectCount > 0 && (
                <span className="rounded-full bg-zinc-200/80 dark:bg-zinc-800 px-1.5 py-0.2 text-[10px] font-mono text-zinc-600 dark:text-zinc-300">
                  {projectCount}
                </span>
              )}
            </Link>
          </nav>
        </div>

        {/* Right: Theme, Model Settings */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleTheme}
            title={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
            className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-1.5 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            {theme === "dark" ? (
              <Sun className="h-3.5 w-3.5" />
            ) : (
              <Moon className="h-3.5 w-3.5" />
            )}
          </button>

          <button
            type="button"
            onClick={onOpenSettings}
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              isModelConfigured
                ? "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 hover:border-violet-500/50"
                : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                isModelConfigured
                  ? "bg-emerald-500"
                  : "bg-amber-500 animate-pulse"
              }`}
            />
            <Settings className="h-3.5 w-3.5" />
            <span className="max-w-[140px] truncate font-mono text-[11px]">
              {modelButtonLabel}
            </span>
          </button>

          <UserMenu />
        </div>
      </div>
    </header>
  );
}
