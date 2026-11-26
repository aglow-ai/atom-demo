"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Code2, Eye, History, Loader2 } from "lucide-react";
import { exportProjectZip, exportStandaloneHtml } from "@/lib/export";
import {
  consumePendingPrompt,
  getProjectById,
  renameProjectById,
  saveProject,
} from "@/lib/project-client";
import {
  loadModelConfig,
  loadProjects as loadLocalProjects,
  loadTheme,
  saveModelConfig,
  saveProjects as saveLocalProjects,
  saveTheme,
} from "@/lib/storage";
import {
  DEFAULT_MODEL_CONFIG,
  type AgentStreamEvent,
  type ChatMessage,
  type ModelConfig,
  type Project,
  type ReActStep,
} from "@/lib/types";
import { ChatPanel } from "./ChatPanel";
import { CodePane } from "./CodePane";
import { PreviewPane } from "./PreviewPane";
import { SettingsModal } from "./SettingsModal";
import { TopBar } from "./TopBar";

interface AtomsWorkbenchProps {
  projectId: string;
}

function mirrorProjectLocally(project: Project) {
  const all = loadLocalProjects();
  const exists = all.some((p) => p.id === project.id);
  const next = exists
    ? all.map((p) => (p.id === project.id ? project : p))
    : [project, ...all];
  saveLocalProjects(next);
}

export function AtomsWorkbench({ projectId }: AtomsWorkbenchProps) {
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [modelConfig, setModelConfig] =
    useState<ModelConfig>(DEFAULT_MODEL_CONFIG);
  const [project, setProject] = useState<Project | null>(null);
  const [viewingSnapshotId, setViewingSnapshotId] = useState<string | null>(
    null
  );

  const [rightTab, setRightTab] = useState<"preview" | "code">("preview");
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [leftWidthPct, setLeftWidthPct] = useState(38);
  const isDraggingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const projectRef = useRef<Project | null>(null);
  const pendingPromptHandledRef = useRef(false);

  const setProjectAndRef = useCallback(
    (updater: Project | null | ((prev: Project | null) => Project | null)) => {
      setProject((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        projectRef.current = next;
        return next;
      });
    },
    []
  );

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 2600);
  }, []);

  /**
   * Subscribe (or reconnect after refresh) to the server-side background job stream.
   * Closing/aborting this reader only detaches the browser — the background job keeps running!
   */
  const attachToJobStream = useCallback(
    async (targetProjectId: string) => {
      streamAbortRef.current?.abort();
      const controller = new AbortController();
      streamAbortRef.current = controller;

      const patchLastAssistantMsg = (
        patcher: (msg: ChatMessage) => ChatMessage
      ) => {
        setProjectAndRef((p) => {
          if (!p) return p;
          let targetIdx = -1;
          for (let i = p.messages.length - 1; i >= 0; i--) {
            if (p.messages[i].role === "assistant") {
              targetIdx = i;
              break;
            }
          }
          if (targetIdx === -1) return p;
          return {
            ...p,
            updatedAt: Date.now(),
            messages: p.messages.map((m, idx) =>
              idx === targetIdx ? patcher(m) : m
            ),
          };
        });
      };

      let shouldReconnect = false;

      try {
        const res = await fetch(
          `/api/agent/stream?projectId=${encodeURIComponent(targetProjectId)}`,
          {
            cache: "no-store",
            signal: controller.signal,
          }
        );

        if (!res.ok || !res.body) {
          setIsRunning(false);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";
        let lastKnownRunning = false;

        const applyEvent = (event: AgentStreamEvent) => {
          switch (event.type) {
            case "idle": {
              lastKnownRunning = false;
              setIsRunning(false);
              break;
            }

            case "job_snapshot": {
              setProjectAndRef(event.project);
              mirrorProjectLocally(event.project);
              const stillActive = event.status === "running";
              lastKnownRunning = stillActive;
              setIsRunning(stillActive);
              if (
                event.status === "done" &&
                Object.keys(event.project.files).length > 0
              ) {
                const lastAssistant = [...event.project.messages]
                  .reverse()
                  .find((m) => m.role === "assistant");
                if (lastAssistant?.filesChanged?.length) {
                  setRightTab("preview");
                }
              }
              break;
            }

            case "thought_delta": {
              lastKnownRunning = true;
              setIsRunning(true);
              patchLastAssistantMsg((m) => {
                const steps = [...(m.steps ?? [])];
                const thoughtId = `thought_${event.iteration}`;
                const idx = steps.findIndex((s) => s.id === thoughtId);
                if (idx === -1) {
                  steps.push({
                    id: thoughtId,
                    iteration: event.iteration,
                    type: "thought",
                    content: event.delta,
                    status: "running",
                    timestamp: Date.now(),
                  });
                } else {
                  steps[idx] = {
                    ...steps[idx],
                    content: (steps[idx].content ?? "") + event.delta,
                  };
                }
                return { ...m, steps };
              });
              break;
            }

            case "thought_done": {
              patchLastAssistantMsg((m) => {
                const steps = [...(m.steps ?? [])];
                const thoughtId = `thought_${event.iteration}`;
                const idx = steps.findIndex((s) => s.id === thoughtId);
                if (idx === -1) {
                  steps.push({
                    id: thoughtId,
                    iteration: event.iteration,
                    type: "thought",
                    content: event.content,
                    status: "success",
                    timestamp: Date.now(),
                  });
                } else {
                  steps[idx] = {
                    ...steps[idx],
                    content: event.content,
                    status: "success",
                  };
                }
                return { ...m, steps };
              });
              break;
            }

            case "tool_start": {
              setIsRunning(true);
              patchLastAssistantMsg((m) => {
                const steps: ReActStep[] = [
                  ...(m.steps ?? []).map((s) =>
                    s.type === "thought" && s.iteration === event.iteration
                      ? { ...s, status: "success" as const }
                      : s
                  ),
                  {
                    id: event.toolCallId,
                    iteration: event.iteration,
                    type: "tool_call",
                    toolCallId: event.toolCallId,
                    toolName: event.toolName,
                    toolArgs: event.args,
                    status: "running",
                    timestamp: Date.now(),
                  },
                ];
                return { ...m, steps };
              });
              break;
            }

            case "tool_result": {
              patchLastAssistantMsg((m) => ({
                ...m,
                steps: (m.steps ?? []).map((s) =>
                  s.id === event.toolCallId
                    ? {
                        ...s,
                        toolResult: event.result,
                        status: (event.ok ? "success" : "error") as
                          | "success"
                          | "error",
                        durationMs: event.durationMs,
                      }
                    : s
                ),
              }));
              break;
            }

            case "files_sync": {
              setProjectAndRef((p) => {
                if (!p) return p;
                const next = {
                  ...p,
                  files: { ...event.files },
                  updatedAt: Date.now(),
                };
                mirrorProjectLocally(next);
                return next;
              });
              if (event.changedFiles.length > 0) {
                setActiveFile(
                  event.changedFiles[event.changedFiles.length - 1]
                );
              }
              break;
            }

            case "done": {
              lastKnownRunning = false;
              if (event.project) {
                setProjectAndRef(event.project);
                mirrorProjectLocally(event.project);
              }
              setIsRunning(false);
              if (
                event.changedFiles.length > 0 &&
                Object.keys(event.files).length > 0
              ) {
                setRightTab("preview");
              }
              break;
            }

            case "error": {
              lastKnownRunning = false;
              patchLastAssistantMsg((m) => ({
                ...m,
                status: event.aborted ? "aborted" : "error",
                error: event.message,
                steps: (m.steps ?? []).map((s) =>
                  s.status === "running" ? { ...s, status: "error" } : s
                ),
              }));
              if (projectRef.current) {
                mirrorProjectLocally(projectRef.current);
              }
              setIsRunning(false);
              break;
            }
          }
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";

          for (const part of parts) {
            const line = part.split("\n").find((l) => l.startsWith("data:"));
            if (!line) continue;
            try {
              const evt = JSON.parse(line.slice(5).trim()) as AgentStreamEvent;
              applyEvent(evt);
            } catch {
              // ignore malformed SSE chunk
            }
          }
        }

        // Seamless SSE rotation for long-running Serverless tasks
        if (lastKnownRunning && !controller.signal.aborted) {
          shouldReconnect = true;
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }
        setIsRunning(false);
      } finally {
        if (streamAbortRef.current === controller) {
          streamAbortRef.current = null;
        }
        if (shouldReconnect && !controller.signal.aborted) {
          setTimeout(() => {
            if (!streamAbortRef.current) {
              void attachToJobStream(targetProjectId);
            }
          }, 400);
        }
      }
    },
    [setProjectAndRef]
  );

  // Load project + auto-reattach to any running background job on mount/refresh
  useEffect(() => {
    let active = true;
    const savedTheme = loadTheme();
    setTheme(savedTheme);
    document.documentElement.classList.toggle("dark", savedTheme === "dark");
    setModelConfig(loadModelConfig());

    async function init() {
      setLoading(true);
      setNotFound(false);
      try {
        const loaded = await getProjectById(projectId);
        if (!active) return;
        if (!loaded.project) {
          setNotFound(true);
          setProjectAndRef(null);
        } else {
          setProjectAndRef(loaded.project);
          // Automatically reconnect if a background job is currently running (or just finished)
          void attachToJobStream(projectId);
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    init();
    return () => {
      active = false;
      // Detach SSE listener on unmount — background job continues running on server!
      streamAbortRef.current?.abort();
    };
  }, [projectId, setProjectAndRef, attachToJobStream]);

  // Split pane dragging handlers
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setLeftWidthPct(Math.min(Math.max(pct, 24), 62));
    };
    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

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

  const handleRenameProject = async (name: string) => {
    const cur = projectRef.current;
    if (!cur) return;
    const updated: Project = { ...cur, name, updatedAt: Date.now() };
    setProjectAndRef(updated);
    const res = await renameProjectById(cur.id, name);
    if (!res.ok) {
      showToast("重命名失败，请稍后重试");
    }
  };

  const handleSelectFileFromChat = (path: string) => {
    setActiveFile(path);
    setRightTab("code");
  };

  const handleSelectSnapshot = (snapshotId: string | null) => {
    const cur = projectRef.current;
    if (!cur) return;
    if (!snapshotId) {
      setViewingSnapshotId(null);
      return;
    }
    const total = cur.snapshots.length;
    const latest = cur.snapshots[total - 1];
    if (latest && latest.id === snapshotId) {
      setViewingSnapshotId(null);
      return;
    }
    const idx = cur.snapshots.findIndex((s) => s.id === snapshotId);
    if (idx === -1) return;
    setViewingSnapshotId(snapshotId);
    setActiveFile(null);
  };

  const handleRestoreSnapshot = async (snapshotId: string) => {
    const cur = projectRef.current;
    if (!cur || isRunning) return;
    const idx = cur.snapshots.findIndex((s) => s.id === snapshotId);
    if (idx === -1) return;
    const snap = cur.snapshots[idx];
    const now = Date.now();
    const versionNum = idx + 1;

    const noticeMsg: ChatMessage = {
      id: `msg_sys_${now}`,
      role: "system",
      content: `已回滚至 v${versionNum} · ${snap.label}`,
      createdAt: now,
    };

    const updated: Project = {
      ...cur,
      files: { ...snap.files },
      messages: [...cur.messages, noticeMsg],
      updatedAt: now,
    };

    setViewingSnapshotId(null);
    setActiveFile(null);
    setProjectAndRef(updated);
    mirrorProjectLocally(updated);
    showToast(`已回滚至 v${versionNum} · ${snap.label}`);

    const res = await saveProject(updated);
    if (!res.ok) {
      showToast("保存回滚结果失败，请稍后重试");
    }
  };

  const handleStop = async () => {
    const cur = projectRef.current;
    if (!cur) return;
    try {
      await fetch("/api/agent/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: cur.id }),
      });
    } catch {
      // ignore
    }
  };

  const runAgent = useCallback(
    async (prompt: string, overrideConfig?: ModelConfig) => {
      const curProject = projectRef.current;
      const cfg = overrideConfig ?? modelConfig;
      if (!curProject || isRunning) return;

      const isConfigured = Boolean(
        cfg.apiKey.trim() && cfg.baseUrl.trim() && cfg.model.trim()
      );
      if (!isConfigured) {
        setSettingsOpen(true);
        return;
      }

      const baseProjectSnapshot = curProject;
      const now = Date.now();
      const optimisticUserMsg: ChatMessage = {
        id: `msg_u_opt_${now}`,
        role: "user",
        content: prompt,
        createdAt: now,
      };
      const optimisticAssistantMsg: ChatMessage = {
        id: `msg_a_opt_${now + 1}`,
        role: "assistant",
        content: "",
        steps: [],
        status: "streaming",
        createdAt: now + 1,
      };

      setProjectAndRef((p) =>
        p
          ? {
              ...p,
              messages: [
                ...p.messages,
                optimisticUserMsg,
                optimisticAssistantMsg,
              ],
            }
          : p
      );
      setViewingSnapshotId(null);
      setIsRunning(true);

      try {
        const res = await fetch("/api/agent/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project: baseProjectSnapshot,
            prompt,
            config: cfg,
          }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          const errMsg = data.error || `启动失败 (HTTP ${res.status})`;
          setProjectAndRef((p) =>
            p
              ? {
                  ...p,
                  messages: p.messages.map((m) =>
                    m.id === optimisticAssistantMsg.id
                      ? { ...m, status: "error", error: errMsg }
                      : m
                  ),
                }
              : p
          );
          setIsRunning(false);
          showToast(errMsg);
          return;
        }

        if (data.project) {
          setProjectAndRef(data.project as Project);
          mirrorProjectLocally(data.project as Project);
        }

        void attachToJobStream(baseProjectSnapshot.id);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "网络异常，请重试";
        setProjectAndRef((p) =>
          p
            ? {
                ...p,
                messages: p.messages.map((m) =>
                  m.id === optimisticAssistantMsg.id
                    ? { ...m, status: "error", error: errMsg }
                    : m
                ),
              }
            : p
        );
        setIsRunning(false);
        showToast(errMsg);
      }
    },
    [attachToJobStream, isRunning, modelConfig, setProjectAndRef, showToast]
  );

  // Auto-run pending prompt passed from the Home Page
  useEffect(() => {
    if (loading || !project || pendingPromptHandledRef.current) return;
    pendingPromptHandledRef.current = true;
    const pending = consumePendingPrompt(project.id);
    if (pending) {
      const cfg = loadModelConfig();
      runAgent(pending, cfg);
    }
  }, [loading, project, runAgent]);

  const handleAutoFix = (errorSummary: string) => {
    runAgent(
      `预览检测到以下异常，请使用工具检查相关代码并彻底修复，最后调用 validate_project 确认无误：\n\n${errorSummary}`
    );
  };

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-zinc-50 dark:bg-[#09090b] text-zinc-500 dark:text-zinc-400 gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin text-violet-500" />
        <span>正在加载项目工作台…</span>
      </div>
    );
  }

  if (notFound || !project) {
    return (
      <div className="flex flex-col h-screen w-screen items-center justify-center bg-zinc-50 dark:bg-[#09090b] text-zinc-800 dark:text-zinc-200 p-6 text-center">
        <h1 className="text-lg font-semibold">未找到该项目</h1>
        <p className="mt-1.5 text-xs text-zinc-500 max-w-sm">
          项目可能已被删除或链接无效。
        </p>
        <Link
          href="/projects"
          className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 px-4 py-2 text-xs font-medium text-white transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          返回我的项目列表
        </Link>
      </div>
    );
  }

  const isConfigured = Boolean(
    modelConfig.apiKey.trim() &&
      modelConfig.baseUrl.trim() &&
      modelConfig.model.trim()
  );
  const viewingSnapIndex = viewingSnapshotId
    ? project.snapshots.findIndex((s) => s.id === viewingSnapshotId)
    : -1;
  const viewingSnapshot =
    viewingSnapIndex !== -1 ? project.snapshots[viewingSnapIndex] : null;
  const displayedFiles = viewingSnapshot ? viewingSnapshot.files : project.files;
  const fileCount = Object.keys(displayedFiles).length;

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-zinc-50 dark:bg-[#09090b] text-zinc-900 dark:text-zinc-100">
      <TopBar
        activeProject={project}
        viewingSnapshotId={viewingSnapshot ? viewingSnapshot.id : null}
        modelConfig={modelConfig}
        theme={theme}
        onRenameProject={handleRenameProject}
        onSelectSnapshot={handleSelectSnapshot}
        onExportHtml={() => {
          exportStandaloneHtml(project.name, displayedFiles);
          showToast("已导出单页应用 (HTML)");
        }}
        onExportZip={async () => {
          await exportProjectZip(project.name, displayedFiles);
          showToast("已导出源码包 (ZIP)");
        }}
        onToggleTheme={handleToggleTheme}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {/* Main Split Workspace */}
      <div
        ref={containerRef}
        className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden"
      >
        {/* Left: Chat & Agent Progress */}
        <div
          className="h-1/2 lg:h-full min-w-0 border-b lg:border-b-0 lg:border-r border-zinc-200 dark:border-zinc-800 shrink-0"
          style={{
            flexBasis: `${leftWidthPct}%`,
          }}
        >
          <ChatPanel
            messages={project.messages}
            isRunning={isRunning}
            isConfigured={isConfigured}
            onSend={(p) => runAgent(p)}
            onStop={handleStop}
            onOpenSettings={() => setSettingsOpen(true)}
            onSelectFile={handleSelectFileFromChat}
            onRestoreSnapshot={handleRestoreSnapshot}
          />
        </div>

        {/* Drag Resizer Handle (desktop only) */}
        <div
          role="separator"
          aria-orientation="vertical"
          onMouseDown={() => {
            isDraggingRef.current = true;
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
          }}
          className="hidden lg:block w-1 cursor-col-resize bg-transparent hover:bg-violet-500/40 active:bg-violet-500 transition-colors shrink-0 -ml-0.5 z-10"
          title="拖拽调整分栏宽度"
        />

        {/* Right: Preview & Read-only Code Tabs */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          {viewingSnapshot && (
            <div className="flex items-center justify-between gap-2 px-3.5 py-2 border-b border-violet-500/25 bg-violet-500/10 text-xs text-violet-700 dark:text-violet-300">
              <div className="flex items-center gap-2 min-w-0">
                <History className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">
                  正在查看历史版本{" "}
                  <strong>
                    v{viewingSnapIndex + 1} · {viewingSnapshot.label}
                  </strong>
                </span>
              </div>
              <button
                type="button"
                onClick={() => setViewingSnapshotId(null)}
                className="rounded-md bg-violet-600 hover:bg-violet-500 px-2.5 py-1 text-[11px] font-medium text-white shrink-0 transition-colors"
              >
                返回最新版本
              </button>
            </div>
          )}

          <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#0e0e11]">
            <div className="inline-flex items-center rounded-lg border border-zinc-200 dark:border-zinc-800 p-0.5 bg-white dark:bg-zinc-900">
              <button
                type="button"
                onClick={() => setRightTab("preview")}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  rightTab === "preview"
                    ? "bg-violet-600 text-white shadow-xs"
                    : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                }`}
              >
                <Eye className="h-3.5 w-3.5" />
                实时预览
              </button>
              <button
                type="button"
                onClick={() => setRightTab("code")}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  rightTab === "code"
                    ? "bg-violet-600 text-white shadow-xs"
                    : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                }`}
              >
                <Code2 className="h-3.5 w-3.5" />
                代码工作区
                {fileCount > 0 && (
                  <span
                    className={`rounded-full px-1.5 text-[10px] font-mono ${
                      rightTab === "code"
                        ? "bg-white/20 text-white"
                        : "bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
                    }`}
                  >
                    {fileCount}
                  </span>
                )}
              </button>
            </div>

            {isRunning && (
              <div className="inline-flex items-center gap-1.5 text-[11px] text-violet-500 font-medium">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>智能体正在后台持续构建…</span>
              </div>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-hidden">
            {rightTab === "preview" ? (
              <PreviewPane
                projectName={project.name}
                files={displayedFiles}
                isRunning={isRunning || Boolean(viewingSnapshot)}
                onAutoFix={handleAutoFix}
              />
            ) : (
              <CodePane
                files={displayedFiles}
                activeFile={activeFile}
                onSelectFile={setActiveFile}
              />
            )}
          </div>
        </div>
      </div>

      {/* Settings Modal */}
      <SettingsModal
        open={settingsOpen}
        config={modelConfig}
        onClose={() => setSettingsOpen(false)}
        onSave={handleSaveModelConfig}
      />

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-4 py-2 text-xs font-medium shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
}
