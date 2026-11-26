"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Clock,
  FileCode2,
  FolderKanban,
  History,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  createProject,
  deleteProjectById,
  listProjects,
} from "@/lib/project-client";
import {
  loadModelConfig,
  loadTheme,
  saveModelConfig,
  saveTheme,
} from "@/lib/storage";
import {
  DEFAULT_MODEL_CONFIG,
  type ModelConfig,
  type ProjectSummary,
} from "@/lib/types";
import { SettingsModal } from "./SettingsModal";
import { SiteHeader } from "./SiteHeader";

function formatRelativeTime(ts: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return "刚刚";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} 小时前`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay} 天前`;
  return new Date(ts).toLocaleDateString("zh-CN");
}

export function ProjectsPage() {
  const router = useRouter();
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [modelConfig, setModelConfig] =
    useState<ModelConfig>(DEFAULT_MODEL_CONFIG);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const [searchQuery, setSearchQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 2600);
  }, []);

  const refreshData = useCallback(async () => {
    setLoading(true);
    try {
      const listRes = await listProjects();
      setProjects(listRes.projects);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const savedTheme = loadTheme();
    setTheme(savedTheme);
    document.documentElement.classList.toggle("dark", savedTheme === "dark");
    setModelConfig(loadModelConfig());
    refreshData();
  }, [refreshData]);

  const handleToggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    saveTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
  };

  const handleSaveModelConfig = (next: ModelConfig) => {
    setModelConfig(next);
    saveModelConfig(next);
    showToast(`已保存模型配置：${next.model}`);
  };

  const handleCreateBlankProject = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const { project } = await createProject({
        name: `新应用 #${projects.length + 1}`,
        description: "",
      });
      router.push(`/project/${encodeURIComponent(project.id)}`);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (deletingId) return;
    setDeletingId(id);
    try {
      await deleteProjectById(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
      showToast("已删除项目");
    } finally {
      setDeletingId(null);
    }
  };

  const filteredProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q)
    );
  }, [projects, searchQuery]);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-[#09090b] text-zinc-900 dark:text-zinc-100 flex flex-col">
      <SiteHeader
        activeNav="projects"
        projectCount={projects.length}
        modelConfig={modelConfig}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-10">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-2.5">
              <FolderKanban className="h-5 w-5 text-violet-500" />
              <h1 className="text-xl font-bold tracking-tight">我的项目</h1>
              <span className="rounded-full bg-zinc-200/80 dark:bg-zinc-800 px-2 py-0.5 text-xs font-mono text-zinc-600 dark:text-zinc-400">
                {projects.length}
              </span>
            </div>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              管理你创建的所有网页应用，随时继续对话迭代与预览
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1 sm:w-60">
              <Search className="h-3.5 w-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索项目名称或描述..."
                className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 pl-8 pr-3 py-1.5 text-xs focus:border-violet-500 focus:outline-none"
              />
            </div>

            <button
              type="button"
              onClick={refreshData}
              disabled={loading}
              title="刷新项目列表"
              className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-2 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
              />
            </button>

            <button
              type="button"
              onClick={handleCreateBlankProject}
              disabled={creating}
              className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white px-3.5 py-1.5 text-xs font-medium shadow-sm transition-colors shrink-0"
            >
              {creating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              新建项目
            </button>
          </div>
        </div>

        {/* Project Grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-40 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111115] animate-pulse p-5"
              />
            ))}
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-800 bg-white/50 dark:bg-[#111115]/50 p-14 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-900 text-zinc-400">
              <FolderKanban className="h-5 w-5" />
            </div>
            <h2 className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
              {searchQuery ? "没有匹配的项目" : "还没有保存任何应用项目"}
            </h2>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 max-w-sm mx-auto">
              {searchQuery
                ? "尝试更换搜索关键词，或清空筛选条件。"
                : "前往首页输入一句话需求，或点击右上角新建空白项目开始构建。"}
            </p>
            {!searchQuery && (
              <Link
                href="/"
                className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 px-4 py-2 text-xs font-medium text-white shadow-sm transition-colors"
              >
                <Sparkles className="h-3.5 w-3.5" />
                去首页创建第一个应用
              </Link>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredProjects.map((proj) => (
              <div
                key={proj.id}
                onClick={() =>
                  router.push(`/project/${encodeURIComponent(proj.id)}`)
                }
                className="group relative flex flex-col justify-between rounded-2xl border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-[#111115] hover:border-violet-500/50 hover:shadow-lg hover:shadow-violet-500/5 transition-all cursor-pointer overflow-hidden"
              >
                <div className="px-4 pt-4 pb-4 border-b border-zinc-100 dark:border-zinc-800/70 bg-gradient-to-br from-zinc-50 to-white dark:from-zinc-900/80 dark:to-[#111115]">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 group-hover:text-violet-600 dark:group-hover:text-violet-400 truncate transition-colors">
                        {proj.name}
                      </h3>
                      <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2 min-h-[2.25rem] leading-relaxed">
                        {proj.description || "空白应用工作台，点击继续构建"}
                      </p>
                    </div>

                    <button
                      type="button"
                      disabled={deletingId === proj.id}
                      onClick={(e) => handleDelete(e, proj.id)}
                      title="删除项目"
                      className="opacity-0 group-hover:opacity-100 rounded-lg p-1.5 text-zinc-400 hover:bg-rose-500/10 hover:text-rose-500 transition-all shrink-0"
                    >
                      {deletingId === proj.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="px-4 py-2.5 flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-400">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center gap-1">
                      <FileCode2 className="h-3 w-3 text-violet-500" />
                      {proj.fileCount} 文件
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <History className="h-3 w-3" />
                      {proj.snapshotCount} 版本
                    </span>
                  </div>
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatRelativeTime(proj.updatedAt)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <SettingsModal
        open={settingsOpen}
        config={modelConfig}
        onClose={() => setSettingsOpen(false)}
        onSave={handleSaveModelConfig}
      />

      {toast && (
        <div className="fixed bottom-4 right-4 z-50 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-4 py-2 text-xs font-medium shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
}
