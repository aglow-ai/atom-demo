"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Code2, Eye, Loader2 } from "lucide-react";
import { exportProjectZip, exportStandaloneHtml } from "@/lib/export";
import {
  consumePendingPrompt,
  getProjectById,
  renameProjectById,
  saveProject,
} from "@/lib/project-client";
import {
  loadModelConfig,
  loadTheme,
  saveModelConfig,
  saveTheme,
} from "@/lib/storage";
import {
  DEFAULT_MODEL_CONFIG,
  type AgentStreamEvent,
  type ChatMessage,
  type ModelConfig,
  type Project,
  type ProjectFiles,
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

export function AtomsWorkbench({ projectId }: AtomsWorkbenchProps) {
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [modelConfig, setModelConfig] =
    useState<ModelConfig>(DEFAULT_MODEL_CONFIG);
  const [project, setProject] = useState<Project | null>(null);
  const [syncState, setSyncState] = useState<"saved" | "saving" | "error">(
    "saved"
  );

  const [rightTab, setRightTab] = useState<"preview" | "code">("preview");
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [leftWidthPct, setLeftWidthPct] = useState(38);
  const isDraggingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const projectRef = useRef<Project | null>(null);
  const pendingPromptHandledRef = useRef(false);

  const setProjectAndRef = useCallback(
    (updater: Project | null | ((prev: Project | null) => Project | null)) => {
      setProject((prev) => {
        const next =
          typeof updater === "function" ? updater(prev) : updater;
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

  const persistProject = useCallback(
    async (target: Project) => {
      setSyncState("saving");
      const res = await saveProject(target);
      if (res.ok) {
        setSyncState("saved");
      } else {
        setSyncState("error");
        showToast("保存失败，请稍后重试");
      }
    },
    [showToast]
  );

  // Load project
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
          setSyncState("saved");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    init();
    return () => {
      active = false;
    };
  }, [projectId, setProjectAndRef]);

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
    setSyncState("saving");
    const res = await renameProjectById(cur.id, name);
    setSyncState(res.ok ? "saved" : "error");
  };

  const handleSelectFileFromChat = (path: string) => {
    setActiveFile(path);
    setRightTab("code");
  };

  const handleRestoreSnapshot = async (snapshotId: string) => {
    const cur = projectRef.current;
    if (!cur || isRunning) return;
    const snap = cur.snapshots.find((s) => s.id === snapshotId);
    if (!snap) return;
    const updated: Project = {
      ...cur,
      files: { ...snap.files },
      updatedAt: Date.now(),
    };
    setProjectAndRef(updated);
    showToast(`已恢复快照：${snap.label}`);
    await persistProject(updated);
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
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

      const now = Date.now();
      const userMsg: ChatMessage = {
        id: `msg_u_${now}`,
        role: "user",
        content: prompt,
        createdAt: now,
      };
      const assistantMsgId = `msg_a_${now + 1}`;
      const assistantMsg: ChatMessage = {
        id: assistantMsgId,
        role: "assistant",
        content: "",
        steps: [],
        status: "streaming",
        createdAt: now + 1,
      };

      const shouldAutoName =
        curProject.messages.length === 0 &&
        (curProject.name === "未命名应用" ||
          /^(?:新)?应用 #\d+$/.test(curProject.name));
      const inferredName = shouldAutoName
        ? prompt.replace(/\s+/g, " ").slice(0, 18)
        : curProject.name;

      const historyPayload = curProject.messages
        .filter((m) => m.content.trim().length > 0)
        .map((m) => ({ role: m.role, content: m.content }));

      const currentFilesSnapshot: ProjectFiles = { ...curProject.files };

      setProjectAndRef((p) => {
        if (!p) return p;
        return {
          ...p,
          name: inferredName,
          description: p.description || prompt.slice(0, 140),
          messages: [...p.messages, userMsg, assistantMsg],
          updatedAt: Date.now(),
        };
      });

      setIsRunning(true);
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const patchAssistantMsg = (
        patcher: (msg: ChatMessage) => ChatMessage
      ) => {
        setProjectAndRef((p) => {
          if (!p) return p;
          return {
            ...p,
            messages: p.messages.map((m) =>
              m.id === assistantMsgId ? patcher(m) : m
            ),
            updatedAt: Date.now(),
          };
        });
      };

      try {
        const res = await fetch("/api/agent/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            files: currentFilesSnapshot,
            history: historyPayload,
            config: cfg,
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          let errMsg = `请求失败 (HTTP ${res.status})`;
          try {
            const j = await res.json();
            if (j?.error) errMsg = j.error;
          } catch {
            // ignore
          }
          patchAssistantMsg((m) => ({
            ...m,
            status: "error",
            error: errMsg,
          }));
          if (projectRef.current) await persistProject(projectRef.current);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";

        const applyEvent = (event: AgentStreamEvent) => {
          switch (event.type) {
            case "thought_delta": {
              patchAssistantMsg((m) => {
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
              patchAssistantMsg((m) => {
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
              patchAssistantMsg((m) => {
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
              patchAssistantMsg((m) => {
                const steps = (m.steps ?? []).map((s) =>
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
                );
                return { ...m, steps };
              });
              break;
            }

            case "files_sync": {
              setProjectAndRef((p) => {
                if (!p) return p;
                return {
                  ...p,
                  files: { ...event.files },
                  updatedAt: Date.now(),
                };
              });
              if (event.changedFiles.length > 0) {
                setActiveFile(
                  event.changedFiles[event.changedFiles.length - 1]
                );
              }
              break;
            }

            case "done": {
              const snapId =
                Object.keys(event.files).length > 0
                  ? `snap_${Date.now()}`
                  : undefined;

              setProjectAndRef((p) => {
                if (!p) return p;
                const nextSnapshots = snapId
                  ? [
                      ...p.snapshots.slice(-14),
                      {
                        id: snapId,
                        label: prompt.replace(/\s+/g, " ").slice(0, 22),
                        files: { ...event.files },
                        createdAt: Date.now(),
                      },
                    ]
                  : p.snapshots;

                return {
                  ...p,
                  files: { ...event.files },
                  snapshots: nextSnapshots,
                  updatedAt: Date.now(),
                  messages: p.messages.map((m) => {
                    if (m.id !== assistantMsgId) return m;
                    const cleanedSteps = (m.steps ?? [])
                      .map((s) =>
                        s.status === "running"
                          ? { ...s, status: "success" as const }
                          : s
                      )
                      .filter((s, i, arr) => {
                        if (
                          i === arr.length - 1 &&
                          s.type === "thought" &&
                          s.content?.trim() === event.summary.trim()
                        ) {
                          return false;
                        }
                        return true;
                      });
                    return {
                      ...m,
                      content: event.summary,
                      steps: cleanedSteps,
                      filesChanged: event.changedFiles,
                      snapshotId: snapId,
                      status: "done",
                    };
                  }),
                };
              });

              if (Object.keys(event.files).length > 0) {
                setRightTab("preview");
              }
              break;
            }

            case "error": {
              patchAssistantMsg((m) => ({
                ...m,
                status: "error",
                error: event.message,
                steps: (m.steps ?? []).map((s) =>
                  s.status === "running" ? { ...s, status: "error" } : s
                ),
              }));
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
              // ignore malformed SSE fragment
            }
          }
        }
      } catch (err) {
        const isAbort = err instanceof Error && err.name === "AbortError";
        patchAssistantMsg((m) => ({
          ...m,
          status: isAbort ? "aborted" : "error",
          error: isAbort
            ? "已手动停止当前任务。"
            : err instanceof Error
            ? err.message
            : "网络异常，请重试。",
          steps: (m.steps ?? []).map((s) =>
            s.status === "running" ? { ...s, status: "error" } : s
          ),
        }));
      } finally {
        setIsRunning(false);
        abortControllerRef.current = null;
        if (projectRef.current) {
          await persistProject(projectRef.current);
        }
      }
    },
    [isRunning, modelConfig, persistProject, setProjectAndRef]
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
      `预览沙箱检测到以下错误，请使用工具检查相关代码并彻底修复，最后调用 validate_project 确认无误：\n\n${errorSummary}`
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
  const fileCount = Object.keys(project.files).length;

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-zinc-50 dark:bg-[#09090b] text-zinc-900 dark:text-zinc-100">
      <TopBar
        activeProject={project}
        modelConfig={modelConfig}
        theme={theme}
        syncState={syncState}
        onRenameProject={handleRenameProject}
        onRestoreSnapshot={handleRestoreSnapshot}
        onExportHtml={() => {
          exportStandaloneHtml(project.name, project.files);
          showToast("已导出单页应用 (HTML)");
        }}
        onExportZip={async () => {
          await exportProjectZip(project.name, project.files);
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
        {/* Left: Chat & ReAct Timeline */}
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
                <span>智能体正在编写代码…</span>
              </div>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-hidden">
            {rightTab === "preview" ? (
              <PreviewPane
                projectName={project.name}
                files={project.files}
                isRunning={isRunning}
                onAutoFix={handleAutoFix}
              />
            ) : (
              <CodePane
                files={project.files}
                activeFile={activeFile}
                onSelectFile={setActiveFile}
              />
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
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
