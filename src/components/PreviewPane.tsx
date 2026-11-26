"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertOctagon,
  ExternalLink,
  Layers,
  Maximize2,
  Minimize2,
  Monitor,
  RefreshCw,
  Smartphone,
  Tablet,
  Wand2,
  X,
} from "lucide-react";
import { buildPreviewHtml } from "@/lib/preview-builder";
import type { ProjectFiles, RuntimeErrorPayload } from "@/lib/types";

interface PreviewPaneProps {
  projectName: string;
  files: ProjectFiles;
  isRunning: boolean;
  onAutoFix: (errorSummary: string) => void;
}

type ViewportMode = "desktop" | "tablet" | "mobile";

export function PreviewPane({
  projectName,
  files,
  isRunning,
  onAutoFix,
}: PreviewPaneProps) {
  const [viewport, setViewport] = useState<ViewportMode>("desktop");
  const [reloadKey, setReloadKey] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [runtimeErrors, setRuntimeErrors] = useState<RuntimeErrorPayload[]>([]);
  const [dismissedErrors, setDismissedErrors] = useState(false);

  const hasFiles = Object.keys(files).length > 0;

  const { html, compileResult } = useMemo(
    () => buildPreviewHtml(files, { title: projectName }),
    [files, projectName]
  );

  // Clear stale runtime errors when code changes or reloads
  useEffect(() => {
    setRuntimeErrors([]);
    setDismissedErrors(false);
  }, [html, reloadKey]);

  // Capture runtime errors sent from the sandboxed iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      if (data && data.__atomsPreviewError && data.payload) {
        const payload = data.payload as RuntimeErrorPayload;
        setDismissedErrors(false);
        setRuntimeErrors((prev) => {
          const isDup = prev.some((e) => e.message === payload.message);
          if (isDup) return prev;
          return [...prev.slice(-4), payload];
        });
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const handleOpenInNewTab = () => {
    const { html: standaloneHtml } = buildPreviewHtml(files, {
      title: projectName,
      standalone: true,
    });
    const blob = new Blob([standaloneHtml], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  };

  const handleTriggerAutoFix = () => {
    const parts: string[] = [];
    if (!compileResult.ok) {
      parts.push(
        "编译错误：\n" +
          compileResult.errors
            .map(
              (e) =>
                `- [${e.file}${e.line ? `:${e.line}` : ""}] ${e.message}`
            )
            .join("\n")
      );
    }
    if (runtimeErrors.length > 0) {
      parts.push(
        "预览运行时错误：\n" +
          runtimeErrors
            .map(
              (e) =>
                `- (${e.type}) ${e.message}${e.stack ? `\n${e.stack.slice(0, 600)}` : ""}`
            )
            .join("\n")
      );
    }
    if (parts.length > 0) {
      onAutoFix(parts.join("\n\n"));
    }
  };

  const hasCompileErrors = hasFiles && !compileResult.ok;
  const totalErrorCount =
    (hasCompileErrors ? compileResult.errors.length : 0) +
    runtimeErrors.length;

  const viewportWidthClass =
    viewport === "mobile"
      ? "w-[375px] max-w-full"
      : viewport === "tablet"
      ? "w-[768px] max-w-full"
      : "w-full";

  return (
    <div
      className={`flex flex-col h-full bg-zinc-100 dark:bg-[#09090b] ${
        fullscreen ? "fixed inset-0 z-40" : ""
      }`}
    >
      {/* Preview Toolbar */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111114]">
        <div className="flex items-center gap-1">
          <div className="inline-flex items-center rounded-lg border border-zinc-200 dark:border-zinc-800 p-0.5 bg-zinc-50 dark:bg-zinc-900">
            {(
              [
                { id: "desktop", icon: Monitor, label: "桌面视口" },
                { id: "tablet", icon: Tablet, label: "平板视口 (768px)" },
                { id: "mobile", icon: Smartphone, label: "手机视口 (375px)" },
              ] as const
            ).map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setViewport(id)}
                title={label}
                className={`rounded-md p-1.5 transition-colors ${
                  viewport === id
                    ? "bg-white dark:bg-zinc-800 text-violet-600 dark:text-violet-400 shadow-xs"
                    : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>

          {hasFiles && (
            <span
              className={`ml-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                totalErrorCount > 0
                  ? "bg-rose-500/10 text-rose-600 dark:text-rose-400"
                  : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  totalErrorCount > 0 ? "bg-rose-500" : "bg-emerald-500"
                }`}
              />
              {totalErrorCount > 0
                ? `${totalErrorCount} 个异常`
                : "预览已就绪"}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={!hasFiles}
            onClick={() => setReloadKey((k) => k + 1)}
            title="重新渲染预览"
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 disabled:opacity-40 transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={!hasFiles}
            onClick={handleOpenInNewTab}
            title="在新标签页打开"
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 disabled:opacity-40 transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setFullscreen((f) => !f)}
            title={fullscreen ? "退出全屏" : "全屏预览"}
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
          >
            {fullscreen ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Preview Canvas */}
      <div className="relative flex-1 overflow-auto flex items-stretch justify-center">
        {!hasFiles ? (
          <div className="flex flex-col items-center justify-center p-8 text-center max-w-md mx-auto">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-violet-500 shadow-sm">
              <Layers className="h-6 w-6" />
            </div>
            <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-200">
              实时可视化预览
            </h2>
            <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
              在左侧描述你的想法后，生成的应用将在此处实时呈现，可直接点击交互体验。
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-1.5">
              {["即时交互预览", "多端视口适配", "异常一键修复", "多轮对话迭代"].map(
                (feature) => (
                  <span
                    key={feature}
                    className="rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2.5 py-0.5 text-[11px] text-zinc-500 dark:text-zinc-400"
                  >
                    {feature}
                  </span>
                )
              )}
            </div>
          </div>
        ) : (
          <div
            className={`h-full transition-all duration-200 ${viewportWidthClass} ${
              viewport !== "desktop"
                ? "my-4 mx-auto rounded-2xl overflow-hidden border border-zinc-300 dark:border-zinc-700 shadow-2xl h-[calc(100%-2rem)]"
                : ""
            }`}
          >
            <iframe
              key={reloadKey}
              title={projectName}
              srcDoc={html}
              sandbox="allow-scripts allow-forms allow-modals allow-popups"
              className="w-full h-full border-0 bg-white"
            />
          </div>
        )}

        {/* Runtime / Compile Error Overlay Drawer */}
        {totalErrorCount > 0 && !dismissedErrors && (
          <div className="absolute bottom-3 left-3 right-3 z-20 rounded-xl border border-rose-500/40 bg-zinc-950/95 text-zinc-100 shadow-2xl backdrop-blur-md overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 bg-rose-500/15 border-b border-rose-500/20">
              <div className="flex items-center gap-2 text-xs font-medium text-rose-300">
                <AlertOctagon className="h-4 w-4 shrink-0 text-rose-400" />
                <span>
                  检测到 {totalErrorCount} 个{hasCompileErrors ? "编译/运行时" : "运行时"}错误
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={isRunning}
                  onClick={handleTriggerAutoFix}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50 px-3 py-1 text-xs font-medium text-white transition-colors"
                >
                  <Wand2 className="h-3.5 w-3.5" />
                  交给智能体自动修复
                </button>
                <button
                  type="button"
                  onClick={() => setDismissedErrors(true)}
                  className="rounded-md p-1 text-zinc-400 hover:text-white hover:bg-white/10"
                  aria-label="隐藏错误提示"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <div className="max-h-36 overflow-y-auto px-3.5 py-2.5 space-y-2 text-[11px] font-mono text-rose-200">
              {hasCompileErrors &&
                compileResult.errors.map((err, idx) => (
                  <div key={`c-${idx}`} className="break-words">
                    <span className="text-rose-400">
                      [{err.file}
                      {err.line ? `:${err.line}` : ""}]
                    </span>{" "}
                    {err.message}
                  </div>
                ))}
              {runtimeErrors.map((err, idx) => (
                <div key={`r-${idx}`} className="break-words">
                  <span className="text-rose-400">[{err.type}]</span>{" "}
                  {err.message}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
