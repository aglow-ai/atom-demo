"use client";

import React, { useEffect, useState } from "react";
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  PlugZap,
  ShieldCheck,
  Sparkles,
  X,
  XCircle,
} from "lucide-react";
import {
  MODEL_PRESETS,
  type ModelConfig,
  type ModelProviderId,
} from "@/lib/types";

interface SettingsModalProps {
  open: boolean;
  config: ModelConfig;
  onClose: () => void;
  onSave: (next: ModelConfig) => void;
}

export function SettingsModal({
  open,
  config,
  onClose,
  onSave,
}: SettingsModalProps) {
  const [draft, setDraft] = useState<ModelConfig>(config);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(config);
      setTestResult(null);
    }
  }, [open, config]);

  if (!open) return null;

  const activePreset =
    MODEL_PRESETS.find((p) => p.id === draft.provider) ?? MODEL_PRESETS[0];

  const handleSelectPreset = (providerId: ModelProviderId) => {
    const preset = MODEL_PRESETS.find((p) => p.id === providerId);
    if (!preset) return;
    setTestResult(null);
    setDraft((prev) => ({
      ...prev,
      provider: providerId,
      baseUrl: providerId === "custom" ? prev.baseUrl : preset.baseUrl,
      model: providerId === "custom" ? prev.model : preset.defaultModel,
    }));
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/model/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: draft.baseUrl,
          apiKey: draft.apiKey,
          model: draft.model,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setTestResult({
          ok: true,
          message: `连接成功 (${data.latencyMs}ms) · 模型: ${data.model}`,
        });
      } else {
        setTestResult({
          ok: false,
          message: data.error || "连接失败，请检查配置。",
        });
      }
    } catch (err) {
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : "网络请求失败",
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...draft,
      baseUrl: draft.baseUrl.trim(),
      apiKey: draft.apiKey.trim(),
      model: draft.model.trim(),
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111114] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/15 text-violet-500">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold">模型设置</h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                配置用于生成应用的 AI 模型与接口密钥
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
            aria-label="关闭设置"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
          {/* Provider Presets */}
          <div>
            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-2">
              服务商预设
            </label>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {MODEL_PRESETS.map((preset) => {
                const active = draft.provider === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleSelectPreset(preset.id)}
                    className={`rounded-lg px-2.5 py-2 text-xs font-medium border transition-all text-center ${
                      active
                        ? "border-violet-500 bg-violet-500/10 text-violet-600 dark:text-violet-300 shadow-sm"
                        : "border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-700"
                    }`}
                  >
                    {preset.name}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
              {activePreset.docsHint}
            </p>
          </div>

          {/* Base URL */}
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
              API Base URL
            </label>
            <input
              type="url"
              required
              value={draft.baseUrl}
              onChange={(e) =>
                setDraft((p) => ({ ...p, baseUrl: e.target.value }))
              }
              placeholder="https://api.openai.com/v1"
              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/70 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
            />
          </div>

          {/* API Key */}
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
              API Key
            </label>
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                required
                value={draft.apiKey}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, apiKey: e.target.value }))
                }
                placeholder={activePreset.keyPlaceholder}
                className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/70 pl-3 pr-10 py-2 text-sm font-mono focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
              />
              <button
                type="button"
                onClick={() => setShowKey((s) => !s)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                aria-label={showKey ? "隐藏 API Key" : "显示 API Key"}
              >
                {showKey ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
              <span>
                API Key 仅保存在当前浏览器本地，不会被服务端存储。
              </span>
            </div>
          </div>

          {/* Model Name */}
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
              模型名称
            </label>
            <input
              type="text"
              required
              value={draft.model}
              onChange={(e) =>
                setDraft((p) => ({ ...p, model: e.target.value }))
              }
              placeholder="例如 gpt-4.1 / gemini-2.5-flash / deepseek-chat"
              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/70 px-3 py-2 text-sm font-mono focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
            />
            {activePreset.suggestedModels.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {activePreset.suggestedModels.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setDraft((p) => ({ ...p, model: m }))}
                    className={`rounded-md px-2 py-0.5 text-[11px] font-mono border transition-colors ${
                      draft.model === m
                        ? "border-violet-500/60 bg-violet-500/15 text-violet-600 dark:text-violet-300"
                        : "border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Advanced Sliders */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50/60 dark:bg-zinc-900/40">
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  单次最大执行步数
                </span>
                <span className="font-mono text-violet-600 dark:text-violet-400">
                  {draft.maxIterations} 步
                </span>
              </div>
              <input
                type="range"
                min={4}
                max={20}
                step={1}
                value={draft.maxIterations}
                onChange={(e) =>
                  setDraft((p) => ({
                    ...p,
                    maxIterations: Number(e.target.value),
                  }))
                }
                className="w-full accent-violet-500"
              />
            </div>

            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50/60 dark:bg-zinc-900/40">
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  采样温度 (Temperature)
                </span>
                <span className="font-mono text-violet-600 dark:text-violet-400">
                  {draft.temperature.toFixed(1)}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={draft.temperature}
                onChange={(e) =>
                  setDraft((p) => ({
                    ...p,
                    temperature: Number(e.target.value),
                  }))
                }
                className="w-full accent-violet-500"
              />
            </div>
          </div>

          {/* Connection Test Feedback */}
          {testResult && (
            <div
              className={`flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-xs border ${
                testResult.ok
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"
              }`}
            >
              {testResult.ok ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
              ) : (
                <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
              )}
              <span className="break-all leading-relaxed">
                {testResult.message}
              </span>
            </div>
          )}

          {/* Footer Actions */}
          <div className="flex items-center justify-between pt-2 border-t border-zinc-200 dark:border-zinc-800">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={testing || !draft.apiKey.trim() || !draft.baseUrl.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 px-3.5 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {testing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <PlugZap className="h-3.5 w-3.5" />
              )}
              测试连接
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-3.5 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                取消
              </button>
              <button
                type="submit"
                className="rounded-lg bg-violet-600 hover:bg-violet-500 px-4 py-2 text-xs font-medium text-white shadow-sm transition-colors"
              >
                保存配置
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
