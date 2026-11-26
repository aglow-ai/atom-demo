"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUp,
  Bot,
  FileCode2,
  History,
  Loader2,
  RotateCcw,
  Settings,
  Sparkles,
  Square,
  User,
} from "lucide-react";
import type { ChatMessage } from "@/lib/types";
import { ReActStepCard } from "./ReActStepCard";

interface ChatPanelProps {
  messages: ChatMessage[];
  isRunning: boolean;
  isConfigured: boolean;
  onSend: (prompt: string) => void;
  onStop: () => void;
  onOpenSettings: () => void;
  onSelectFile: (path: string) => void;
  onRestoreSnapshot: (snapshotId: string) => void;
}

const EXAMPLE_PROMPTS = [
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

export function ChatPanel({
  messages,
  isRunning,
  isConfigured,
  onSend,
  onStop,
  onOpenSettings,
  onSelectFile,
  onRestoreSnapshot,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isRunning) return;
    if (!isConfigured) {
      onOpenSettings();
      return;
    }
    setInput("");
    onSend(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleUseExample = (prompt: string) => {
    if (!isConfigured) {
      setInput(prompt);
      onOpenSettings();
      return;
    }
    onSend(prompt);
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#0c0c0f]">
      {/* Message List */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-5 space-y-5"
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center min-h-full py-6 max-w-md mx-auto">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-lg shadow-violet-500/25">
              <Sparkles className="h-6 w-6" />
            </div>
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 text-center">
              描述你想构建的网页应用
            </h1>
            <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400 text-center leading-relaxed">
              智能体将自动拆解功能、生成完整应用并在右侧实时可视化呈现。
            </p>

            {!isConfigured && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="mt-4 inline-flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2 text-xs font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-500/15 transition-colors"
              >
                <Settings className="h-3.5 w-3.5" />
                先完成模型设置开始体验
              </button>
            )}

            <div className="mt-6 w-full space-y-2">
              <div className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider px-1">
                一键试试示例需求
              </div>
              <div className="grid grid-cols-1 gap-2">
                {EXAMPLE_PROMPTS.map((item) => (
                  <button
                    key={item.title}
                    type="button"
                    onClick={() => handleUseExample(item.prompt)}
                    className="group text-left rounded-xl border border-zinc-200 dark:border-zinc-800/90 bg-zinc-50/70 dark:bg-zinc-900/40 hover:border-violet-500/40 hover:bg-violet-500/5 px-3.5 py-2.5 transition-all"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-zinc-800 dark:text-zinc-200 group-hover:text-violet-600 dark:group-hover:text-violet-300">
                        {item.title}
                      </span>
                      <span className="rounded-md bg-zinc-200/70 dark:bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:text-zinc-400">
                        {item.tag}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400 line-clamp-2 leading-relaxed">
                      {item.prompt}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          messages.map((msg) => {
            if (msg.role === "system") {
              return (
                <div
                  key={msg.id}
                  className="flex items-center justify-center py-1"
                >
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 dark:border-zinc-800 bg-zinc-100/80 dark:bg-zinc-900/80 px-3 py-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                    <RotateCcw className="h-3 w-3 text-violet-500 shrink-0" />
                    <span>{msg.content}</span>
                  </div>
                </div>
              );
            }

            if (msg.role === "user") {
              return (
                <div key={msg.id} className="flex items-start gap-2.5 justify-end">
                  <div className="max-w-[88%] rounded-2xl rounded-tr-sm bg-violet-600 text-white px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap shadow-sm">
                    {msg.content}
                  </div>
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 mt-0.5">
                    <User className="h-3.5 w-3.5" />
                  </div>
                </div>
              );
            }

            return (
              <div key={msg.id} className="flex items-start gap-2.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 text-white mt-0.5 shadow-sm">
                  <Bot className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  {msg.steps && msg.steps.length > 0 && (
                    <ReActStepCard
                      steps={msg.steps}
                      isStreaming={msg.status === "streaming"}
                      onSelectFile={onSelectFile}
                    />
                  )}

                  {msg.status === "streaming" &&
                    (!msg.steps || msg.steps.length === 0) &&
                    !msg.content &&
                    !msg.error && (
                      <div className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 px-3.5 py-2.5 text-xs text-zinc-600 dark:text-zinc-300">
                        <Loader2 className="h-3.5 w-3.5 text-violet-500 animate-spin shrink-0" />
                        <span>智能体正在思考并分析需求…</span>
                      </div>
                    )}

                  {msg.error && (
                    <div className="mb-2.5 flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-xs text-rose-600 dark:text-rose-300">
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span className="whitespace-pre-wrap break-words leading-relaxed">
                        {msg.error}
                      </span>
                    </div>
                  )}

                  {msg.content && (
                    <div className="text-sm text-zinc-800 dark:text-zinc-200 leading-relaxed whitespace-pre-wrap">
                      {msg.content}
                    </div>
                  )}

                  {/* Footer metadata: changed files + snapshot restore */}
                  {(msg.filesChanged?.length || msg.snapshotId) && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      {msg.filesChanged?.map((filePath) => (
                        <button
                          key={filePath}
                          type="button"
                          onClick={() => onSelectFile(filePath)}
                          className="inline-flex items-center gap-1 rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-2 py-0.5 text-[11px] font-mono text-zinc-600 dark:text-zinc-300 hover:border-violet-500/50 hover:text-violet-500 transition-colors"
                        >
                          <FileCode2 className="h-3 w-3 text-violet-500" />
                          {filePath}
                        </button>
                      ))}
                      {msg.snapshotId && (
                        <button
                          type="button"
                          disabled={isRunning}
                          onClick={() => onRestoreSnapshot(msg.snapshotId!)}
                          className="inline-flex items-center gap-1 rounded-md border border-zinc-200 dark:border-zinc-800 px-2 py-0.5 text-[11px] text-zinc-500 dark:text-zinc-400 hover:border-violet-500/50 hover:text-violet-600 dark:hover:text-violet-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          title="将应用代码回滚到此版本"
                        >
                          <History className="h-3 w-3" />
                          恢复此版本
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Input Composer */}
      <div className="border-t border-zinc-200 dark:border-zinc-800/90 p-3 bg-white dark:bg-[#0c0c0f]">
        {!isConfigured && messages.length > 0 && (
          <div className="mb-2 flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
            <span>尚未配置 API Key，无法调用大模型</span>
            <button
              type="button"
              onClick={onOpenSettings}
              className="font-medium underline underline-offset-2 hover:text-amber-500"
            >
              立即配置
            </button>
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/70 focus-within:border-violet-500 focus-within:ring-2 focus-within:ring-violet-500/20 transition-all"
        >
          <textarea
            ref={textareaRef}
            rows={3}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              messages.length === 0
                ? "输入你想生成的网页应用，例如：做一个带图表统计的番茄钟..."
                : "继续描述你想修改或新增的功能，例如：改成柔和浅色风并增加导出按钮..."
            }
            className="w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none"
          />

          <div className="flex items-center justify-between px-3 pb-2.5 pt-1">
            <span className="text-[11px] text-zinc-400">
              Enter 发送 · Shift + Enter 换行
            </span>

            {isRunning ? (
              <button
                type="button"
                onClick={onStop}
                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors"
              >
                <Square className="h-3 w-3 fill-current" />
                停止生成
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors"
              >
                <ArrowUp className="h-3.5 w-3.5" />
                发送
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
