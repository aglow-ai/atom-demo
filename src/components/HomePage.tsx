"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Atom,
  FolderKanban,
  Loader2,
  X,
} from "lucide-react";
import {
  consumePendingHomePrompt,
  createProject,
  listProjects,
  setPendingHomePrompt,
  setPendingPrompt,
} from "@/lib/project-client";
import {
  loadModelConfig,
  loadTheme,
  saveModelConfig,
  saveTheme,
} from "@/lib/storage";
import {
  DEFAULT_MODEL_CONFIG,
  getResolvedModelMode,
  isEffectiveModelReady,
  type ModelConfig,
} from "@/lib/types";
import { useAuth } from "./AuthProvider";
import { useBilling } from "./BillingProvider";
import { GoogleIcon } from "./GoogleIcon";
import { SettingsModal } from "./SettingsModal";
import { SiteHeader } from "./SiteHeader";

const STARTER_TEMPLATES = [
  {
    title: "番茄钟专注工作台",
    tag: "效率工具",
    prompt:
      "帮我生成一个现代暗黑风格的番茄钟效率工作台：包含专注/短休/长休环形倒计时、任务清单（支持勾选与绑定当前专注任务）、以及本周专注时长柱状图统计。",
  },
  {
    title: "个人记账与消费看板",
    tag: "数据看板",
    prompt:
      "制作一个精致的个人记账与财务看板应用：支持新增收入/支出记录、按分类筛选和搜索、顶部展示本月结余/总收入/总支出统计卡片，并搭配分类消费占比饼图和近 7 日趋势折线图。",
  },
  {
    title: "敏捷 Kanban 任务板",
    tag: "团队协作",
    prompt:
      "设计一个高颜值的 Kanban 任务看板应用：包含待办、进行中、评审中、已完成四列，支持新建/编辑/删除任务卡片、一键流转状态、优先级徽章、关键词搜索与按标签过滤。",
  },
  {
    title: "霓虹 2048 益智游戏",
    tag: "互动游戏",
    prompt:
      "创建一个霓虹玻璃拟态风格的 2048 益智小游戏：支持键盘方向键与屏幕按钮操作、实时当前分与最高分记录、一步撤销功能、重新开始以及合成 2048 时的庆祝彩带效果。",
  },
];

export function HomePage() {
  const router = useRouter();
  const { user, signInWithGoogle } = useAuth();
  const { systemModel, credits } = useBilling();
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [modelConfig, setModelConfig] =
    useState<ModelConfig>(DEFAULT_MODEL_CONFIG);
  const [projectCount, setProjectCount] = useState<number>(0);

  const [prompt, setPrompt] = useState("");
  const [creating, setCreating] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loginPromptOpen, setLoginPromptOpen] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 2600);
  }, []);

  useEffect(() => {
    const savedTheme = loadTheme();
    setTheme(savedTheme);
    document.documentElement.classList.toggle("dark", savedTheme === "dark");
    setModelConfig(loadModelConfig());
  }, []);

  useEffect(() => {
    if (!user) {
      setProjectCount(0);
      return;
    }

    const restoredPrompt = consumePendingHomePrompt();
    if (restoredPrompt) {
      setPrompt(restoredPrompt);
      showToast("登录成功，已为你恢复需求内容");
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      });
    }

    listProjects().then((res) => {
      if (!res.unauthorized && !res.error) {
        setProjectCount(res.projects.length);
      }
    });
  }, [user, showToast]);

  const modelMode = getResolvedModelMode(modelConfig);
  const isModelConfigured = isEffectiveModelReady(modelConfig, systemModel);

  const handleToggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    saveTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
  };

  const handleSaveModelConfig = (next: ModelConfig) => {
    setModelConfig(next);
    saveModelConfig(next);
    const nextMode = getResolvedModelMode(next);
    showToast(
      nextMode === "system"
        ? `已切换为系统默认模型${systemModel.available ? `：${systemModel.model}` : ""}`
        : `已保存自定义模型：${next.model}`
    );
  };

  const handleGoogleSignInFromModal = async () => {
    if (signingIn) return;
    setSigningIn(true);
    const res = await signInWithGoogle("/");
    if (res.error) {
      setSigningIn(false);
      showToast(res.error);
    }
  };

  const launchProjectWithPrompt = async (
    rawPrompt: string,
    customTitle?: string
  ) => {
    const cleaned = rawPrompt.trim();
    if (!cleaned || creating) return;

    if (!user) {
      setPendingHomePrompt(cleaned);
      setLoginPromptOpen(true);
      return;
    }

    if (!isModelConfigured) {
      setPrompt(cleaned);
      setSettingsOpen(true);
      showToast("请先完成模型设置");
      return;
    }

    if (
      modelMode === "system" &&
      credits &&
      credits.balance < systemModel.minCreditsPerRun
    ) {
      setPrompt(cleaned);
      setSettingsOpen(true);
      showToast("积分不足，请切换为自定义 API Key 继续使用");
      return;
    }

    setCreating(true);
    try {
      const name =
        customTitle || cleaned.replace(/\s+/g, " ").slice(0, 18) || "未命名应用";
      const res = await createProject({
        name,
        description: cleaned.slice(0, 140),
      });
      if (res.unauthorized) {
        setPendingHomePrompt(cleaned);
        router.push("/login?next=/");
        return;
      }
      if (!res.project) {
        showToast(res.error || "创建项目失败，请稍后重试");
        return;
      }
      setPendingPrompt(res.project.id, cleaned);
      router.push(`/project/${encodeURIComponent(res.project.id)}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-[#09090b] text-zinc-900 dark:text-zinc-100 flex flex-col">
      <SiteHeader
        activeNav="home"
        projectCount={projectCount}
        modelConfig={modelConfig}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {/* Focused Full-Height Hero */}
      <main className="relative flex-1 flex flex-col items-center justify-center overflow-hidden px-4 sm:px-6 py-16">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 -top-24 h-96 bg-[radial-gradient(ellipse_at_top,rgba(124,58,237,0.20),transparent_68%)]"
        />

        <div className="relative w-full max-w-2xl mx-auto text-center">
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 leading-tight">
            今天想做什么应用？
          </h1>
          <p className="mt-3 text-sm sm:text-base text-zinc-500 dark:text-zinc-400">
            说出想法，即刻生成可交互网页
          </p>

          {/* Centered Prompt Box */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              launchProjectWithPrompt(prompt);
            }}
            className="mt-8 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111115] shadow-2xl shadow-black/5 dark:shadow-black/40 focus-within:border-violet-500 focus-within:ring-2 focus-within:ring-violet-500/20 transition-all text-left"
          >
            <textarea
              ref={textareaRef}
              rows={4}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  launchProjectWithPrompt(prompt);
                }
              }}
              placeholder="描述你想构建的应用，例如：做一个带专注计时、任务清单和本周统计图表的番茄钟工作台..."
              className="w-full resize-none bg-transparent px-4 pt-4 pb-2 text-sm sm:text-base text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none"
            />
            <div className="flex items-center justify-between gap-2 px-4 pb-3.5 pt-1">
              <span className="text-[11px] text-zinc-400">
                {!user
                  ? "新用户 Google 登录即赠 100 积分，零配置开箱体验"
                  : !isModelConfigured
                    ? "提示：请先点击右上角「模型设置」"
                    : modelMode === "system"
                      ? `使用系统默认模型 (${systemModel.model}) · 按 Token 折算积分`
                      : "按 Enter 立即生成，Shift + Enter 换行"}
              </span>
              <button
                type="submit"
                disabled={!prompt.trim() || creating}
                className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 text-xs sm:text-sm font-medium text-white shadow-sm shadow-violet-600/25 transition-all"
              >
                {creating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <span>开始构建</span>
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Starter Template Chips */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            {STARTER_TEMPLATES.map((tpl) => (
              <button
                key={tpl.title}
                type="button"
                disabled={creating}
                onClick={() => {
                  setPrompt(tpl.prompt);
                  requestAnimationFrame(() => {
                    const el = textareaRef.current;
                    if (el) {
                      el.focus();
                      el.setSelectionRange(el.value.length, el.value.length);
                    }
                  });
                }}
                className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/70 hover:border-violet-500/50 hover:bg-violet-500/5 px-3.5 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 transition-all"
              >
                <span className="font-medium">{tpl.title}</span>
                <span className="text-[10px] text-zinc-400">{tpl.tag}</span>
              </button>
            ))}
          </div>

          {user && projectCount > 0 && (
            <div className="mt-10">
              <Link
                href="/projects"
                className="inline-flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400 hover:text-violet-600 dark:hover:text-violet-400 transition-colors"
              >
                <FolderKanban className="h-3.5 w-3.5" />
                <span>查看我的 {projectCount} 个历史项目</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          )}
        </div>
      </main>

      <SettingsModal
        open={settingsOpen}
        config={modelConfig}
        onClose={() => setSettingsOpen(false)}
        onSave={handleSaveModelConfig}
      />

      {/* Login Prompt Modal for Unauthenticated Build */}
      {loginPromptOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
          onClick={() => !signingIn && setLoginPromptOpen(false)}
        >
          <div
            className="relative w-full max-w-sm rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#141418] p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              disabled={signingIn}
              onClick={() => setLoginPromptOpen(false)}
              className="absolute right-3.5 top-3.5 rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="flex flex-col items-center text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-md shadow-violet-500/20">
                <Atom className="h-5 w-5" />
              </div>
              <h2 className="mt-4 text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
                登录后开始构建应用
              </h2>
              <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                你的应用描述已暂存。使用 Google 账号登录后，即可创建云端项目并在个人空间中持续迭代。
              </p>
            </div>

            <button
              type="button"
              onClick={handleGoogleSignInFromModal}
              disabled={signingIn}
              className="mt-5 w-full inline-flex items-center justify-center gap-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:border-violet-500/50 disabled:opacity-60 px-4 py-2.5 text-sm font-medium text-zinc-900 dark:text-zinc-100 shadow-sm transition-all"
            >
              {signingIn ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-violet-500" />
                  <span>正在跳转到 Google...</span>
                </>
              ) : (
                <>
                  <GoogleIcon className="h-4 w-4 shrink-0" />
                  <span>使用 Google 账号继续</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-4 right-4 z-50 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-4 py-2 text-xs font-medium shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
}
