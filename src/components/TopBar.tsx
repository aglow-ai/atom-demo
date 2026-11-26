"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Atom,
  Check,
  Download,
  FileArchive,
  FileCode,
  FolderKanban,
  History,
  Home,
  Loader2,
  Moon,
  Pencil,
  Settings,
  Sun,
} from "lucide-react";
import type { ModelConfig, Project } from "@/lib/types";

interface TopBarProps {
  activeProject: Project;
  modelConfig: ModelConfig;
  theme: "dark" | "light";
  syncState: "saved" | "saving" | "error";
  onRenameProject: (name: string) => void;
  onRestoreSnapshot: (snapshotId: string) => void;
  onExportHtml: () => void;
  onExportZip: () => void;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
}

export function TopBar({
  activeProject,
  modelConfig,
  theme,
  syncState,
  onRenameProject,
  onRestoreSnapshot,
  onExportHtml,
  onExportZip,
  onToggleTheme,
  onOpenSettings,
}: TopBarProps) {
  const [openMenu, setOpenMenu] = useState<"snapshots" | "export" | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(activeProject.name);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setNameDraft(activeProject.name);
  }, [activeProject.name]);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  const isConfigured = Boolean(
    modelConfig.apiKey.trim() &&
      modelConfig.baseUrl.trim() &&
      modelConfig.model.trim()
  );
  const hasFiles = Object.keys(activeProject.files).length > 0;

  const commitRename = () => {
    setEditingName(false);
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== activeProject.name) {
      onRenameProject(trimmed);
    } else {
      setNameDraft(activeProject.name);
    }
  };

  return (
    <header
      ref={menuRef}
      className="h-13 shrink-0 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111114] px-3.5 flex items-center justify-between gap-3 select-none z-30"
    >
      {/* Left: Navigation & Project Title */}
      <div className="flex items-center gap-2 min-w-0">
        <Link
          href="/"
          className="flex items-center gap-2 shrink-0 hover:opacity-90 transition-opacity"
          title="返回首页"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-sm">
            <Atom className="h-4 w-4" />
          </div>
          <span className="font-semibold text-sm tracking-tight hidden md:inline">
            Atoms
          </span>
        </Link>

        <Link
          href="/"
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors shrink-0"
          title="返回首页"
        >
          <Home className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">首页</span>
        </Link>

        <Link
          href="/projects"
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors shrink-0"
          title="查看我的项目"
        >
          <FolderKanban className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">我的项目</span>
        </Link>

        <span className="text-zinc-300 dark:text-zinc-700">/</span>

        {/* Project Name (Inline Rename) */}
        {editingName ? (
          <input
            type="text"
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") {
                setEditingName(false);
                setNameDraft(activeProject.name);
              }
            }}
            className="rounded-md border border-violet-500 bg-zinc-50 dark:bg-zinc-900 px-2 py-1 text-xs font-medium focus:outline-none w-44"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditingName(true)}
            className="group inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-zinc-800 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors max-w-[210px]"
            title="点击重命名项目"
          >
            <span className="truncate">{activeProject.name}</span>
            <Pencil className="h-3 w-3 text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
          </button>
        )}

        {/* Save Status */}
        <span
          className={`hidden md:inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
            syncState === "saved"
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : syncState === "saving"
              ? "bg-violet-500/10 text-violet-600 dark:text-violet-400"
              : "bg-rose-500/10 text-rose-600 dark:text-rose-400"
          }`}
        >
          {syncState === "saving" ? (
            <Loader2 className="h-2.5 w-2.5 animate-spin" />
          ) : syncState === "saved" ? (
            <Check className="h-2.5 w-2.5" />
          ) : null}
          <span>
            {syncState === "saved"
              ? "已保存"
              : syncState === "saving"
              ? "保存中…"
              : "保存失败"}
          </span>
        </span>
      </div>

      {/* Right: Snapshots, Export, Theme, Settings */}
      <div className="flex items-center gap-2">
        {activeProject.snapshots.length > 0 && (
          <div className="relative">
            <button
              type="button"
              onClick={() =>
                setOpenMenu((m) => (m === "snapshots" ? null : "snapshots"))
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <History className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">
                版本 ({activeProject.snapshots.length})
              </span>
            </button>

            {openMenu === "snapshots" && (
              <div className="absolute right-0 mt-1.5 w-64 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#141418] shadow-xl p-1.5 z-40">
                <div className="px-2 py-1 text-[11px] font-medium text-zinc-400">
                  点击恢复历史版本
                </div>
                <div className="max-h-60 overflow-y-auto space-y-0.5 mt-1">
                  {[...activeProject.snapshots].reverse().map((snap, idx) => (
                    <button
                      key={snap.id}
                      type="button"
                      onClick={() => {
                        onRestoreSnapshot(snap.id);
                        setOpenMenu(null);
                      }}
                      className="w-full text-left rounded-lg px-2.5 py-2 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                    >
                      <div className="font-medium text-zinc-800 dark:text-zinc-200 truncate">
                        v{activeProject.snapshots.length - idx} · {snap.label}
                      </div>
                      <div className="text-[10px] text-zinc-400 mt-0.5">
                        {new Date(snap.createdAt).toLocaleTimeString()} ·{" "}
                        {Object.keys(snap.files).length} 个文件
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="relative">
          <button
            type="button"
            disabled={!hasFiles}
            onClick={() =>
              setOpenMenu((m) => (m === "export" ? null : "export"))
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">导出</span>
          </button>

          {openMenu === "export" && (
            <div className="absolute right-0 mt-1.5 w-48 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#141418] shadow-xl p-1.5 z-40">
              <button
                type="button"
                onClick={() => {
                  onExportHtml();
                  setOpenMenu(null);
                }}
                className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <FileCode className="h-3.5 w-3.5 text-violet-500" />
                导出单页应用 (HTML)
              </button>
              <button
                type="button"
                onClick={() => {
                  onExportZip();
                  setOpenMenu(null);
                }}
                className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <FileArchive className="h-3.5 w-3.5 text-emerald-500" />
                导出源码包 (ZIP)
              </button>
            </div>
          )}
        </div>

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
            isConfigured
              ? "border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 hover:border-violet-500/50"
              : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20"
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${
              isConfigured ? "bg-emerald-500" : "bg-amber-500 animate-pulse"
            }`}
          />
          <Settings className="h-3.5 w-3.5" />
          <span className="max-w-[130px] truncate font-mono text-[11px]">
            {isConfigured ? modelConfig.model : "模型设置"}
          </span>
        </button>
      </div>
    </header>
  );
}
