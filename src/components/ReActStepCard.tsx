"use client";

import React, { useState } from "react";
import {
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileCode2,
  FileEdit,
  FileSearch,
  FolderTree,
  Loader2,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import type { ReActStep } from "@/lib/types";

interface ReActStepCardProps {
  steps: ReActStep[];
  isStreaming?: boolean;
  onSelectFile?: (path: string) => void;
}

function getToolMeta(toolName?: string) {
  switch (toolName) {
    case "list_files":
      return {
        label: "浏览项目目录",
        icon: FolderTree,
        accent: "text-sky-500 bg-sky-500/10 border-sky-500/20",
      };
    case "read_file":
      return {
        label: "读取文件",
        icon: FileSearch,
        accent: "text-blue-500 bg-blue-500/10 border-blue-500/20",
      };
    case "write_file":
      return {
        label: "写入文件",
        icon: FileCode2,
        accent: "text-violet-500 bg-violet-500/10 border-violet-500/20",
      };
    case "edit_file":
      return {
        label: "编辑代码",
        icon: FileEdit,
        accent: "text-amber-500 bg-amber-500/10 border-amber-500/20",
      };
    case "delete_file":
      return {
        label: "删除文件",
        icon: Trash2,
        accent: "text-rose-500 bg-rose-500/10 border-rose-500/20",
      };
    case "validate_project":
      return {
        label: "应用完整性校验",
        icon: ShieldCheck,
        accent: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20",
      };
    default:
      return {
        label: toolName || "工具调用",
        icon: FileCode2,
        accent: "text-zinc-500 bg-zinc-500/10 border-zinc-500/20",
      };
  }
}

export function ReActStepCard({
  steps,
  isStreaming,
  onSelectFile,
}: ReActStepCardProps) {
  const [expanded, setExpanded] = useState(true);
  const [openResults, setOpenResults] = useState<Record<string, boolean>>({});

  if (!steps || steps.length === 0) return null;

  const toolCalls = steps.filter((s) => s.type === "tool_call");
  const maxIter = steps.reduce((m, s) => Math.max(m, s.iteration), 1);
  const hasRunning =
    isStreaming || steps.some((s) => s.status === "running");

  const toggleResult = (id: string) => {
    setOpenResults((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="mb-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-900/50 overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between px-3.5 py-2.5 text-xs hover:bg-zinc-100/70 dark:hover:bg-zinc-800/50 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          {hasRunning ? (
            <Loader2 className="h-3.5 w-3.5 text-violet-500 animate-spin shrink-0" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
          )}
          <span className="font-medium text-zinc-700 dark:text-zinc-200 truncate">
            {hasRunning ? "智能体构建中…" : "智能体执行过程"}
          </span>
          <span className="rounded-full bg-zinc-200/80 dark:bg-zinc-800 px-2 py-0.5 text-[10px] font-mono text-zinc-600 dark:text-zinc-400">
            {maxIter} 轮 · {toolCalls.length} 个步骤
          </span>
        </div>
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
        )}
      </button>

      {/* Body */}
      {expanded && (
        <div className="border-t border-zinc-200/80 dark:border-zinc-800/80 px-3.5 py-2.5 space-y-2">
          {steps.map((step) => {
            if (step.type === "thought") {
              if (!step.content?.trim()) return null;
              return (
                <div
                  key={step.id}
                  className="flex items-start gap-2 text-xs text-zinc-600 dark:text-zinc-300"
                >
                  <Brain className="h-3.5 w-3.5 text-violet-500 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] tracking-wider text-zinc-400 font-mono mb-0.5">
                      思考 #{step.iteration}
                    </div>
                    <p className="whitespace-pre-wrap leading-relaxed text-zinc-700 dark:text-zinc-300">
                      {step.content}
                    </p>
                  </div>
                </div>
              );
            }

            const meta = getToolMeta(step.toolName);
            const Icon = meta.icon;
            const filePath =
              typeof step.toolArgs?.path === "string"
                ? step.toolArgs.path
                : null;
            const isResultOpen =
              openResults[step.id] ?? step.status === "error";

            return (
              <div
                key={step.id}
                className="rounded-lg border border-zinc-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-950/60 overflow-hidden"
              >
                <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium shrink-0 ${meta.accent}`}
                    >
                      <Icon className="h-3 w-3" />
                      {meta.label}
                    </span>

                    {filePath && (
                      <button
                        type="button"
                        onClick={() => onSelectFile?.(filePath)}
                        className="font-mono text-[11px] text-zinc-700 dark:text-zinc-300 hover:text-violet-500 dark:hover:text-violet-400 truncate underline-offset-2 hover:underline"
                        title={`打开 ${filePath}`}
                      >
                        {filePath}
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {typeof step.durationMs === "number" && (
                      <span className="text-[10px] font-mono text-zinc-400">
                        {step.durationMs}ms
                      </span>
                    )}
                    {step.status === "running" && (
                      <Loader2 className="h-3.5 w-3.5 text-violet-500 animate-spin" />
                    )}
                    {step.status === "success" && (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    )}
                    {step.status === "error" && (
                      <XCircle className="h-3.5 w-3.5 text-rose-500" />
                    )}
                    {step.toolResult && (
                      <button
                        type="button"
                        onClick={() => toggleResult(step.id)}
                        className="text-[10px] text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                      >
                        {isResultOpen ? "收起" : "详情"}
                      </button>
                    )}
                  </div>
                </div>

                {isResultOpen && step.toolResult && (
                  <div
                    className={`border-t px-2.5 py-2 text-[11px] font-mono whitespace-pre-wrap break-words max-h-40 overflow-y-auto ${
                      step.status === "error"
                        ? "border-rose-500/20 bg-rose-500/5 text-rose-600 dark:text-rose-300"
                        : "border-zinc-100 dark:border-zinc-800/80 bg-zinc-50 dark:bg-zinc-900/50 text-zinc-600 dark:text-zinc-400"
                    }`}
                  >
                    {step.toolResult}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
