"use client";

import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Coins,
  Cpu,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  PlugZap,
  ShieldCheck,
  Sparkles,
  X,
  XCircle,
} from "lucide-react";
import {
  getResolvedModelMode,
  MODEL_PRESETS,
  type ModelConfig,
  type ModelConfigMode,
  type ModelProviderId,
} from "@/lib/types";
import { useAuth } from "./AuthProvider";
import { useBilling } from "./BillingProvider";

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
  const { user } = useAuth();
  const {
    systemModel,
    credits,
    loading: billingLoading,
    refreshBilling,
  } = useBilling();
  const [draft, setDraft] = useState<ModelConfig>(config);
  const [mode, setMode] = useState<ModelConfigMode>(
    getResolvedModelMode(config)
  );
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(config);
      setMode(getResolvedModelMode(config));
      setTestResult(null);
      if (user) {
        void refreshBilling();
      }
    }
  }, [open, config, user, refreshBilling]);

  if (!open) return null;

  const activePreset =
    MODEL_PRESETS.find((p) => p.id === draft.provider) ?? MODEL_PRESETS[0];
  const systemProviderName =
    MODEL_PRESETS.find((p) => p.id === systemModel.provider)?.name ??
    systemModel.provider;

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
          provider: draft.provider,
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
      mode,
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
                可直接使用系统默认模型（积分计费），或配置自定义 API Key
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
        <form
          onSubmit={handleSubmit}
          className="p-6 space-y-5 max-h-[80vh] overflow-y-auto"
        >
          {/* Mode Switcher */}
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 p-1">
            <button
              type="button"
              onClick={() => {
                setMode("system");
                setTestResult(null);
              }}
              className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all ${
                mode === "system"
                  ? "bg-white dark:bg-zinc-800 text-violet-600 dark:text-violet-300 shadow-xs ring-1 ring-zinc-200/80 dark:ring-zinc-700"
                  : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200"
              }`}
            >
              <Cpu className="h-3.5 w-3.5" />
              <span>系统默认模型</span>
              <span className="rounded bg-amber-500/15 px-1.5 py-0.2 text-[10px] text-amber-600 dark:text-amber-300">
                积分计费
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("custom");
                setTestResult(null);
              }}
              className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all ${
                mode === "custom"
                  ? "bg-white dark:bg-zinc-800 text-violet-600 dark:text-violet-300 shadow-xs ring-1 ring-zinc-200/80 dark:ring-zinc-700"
                  : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200"
              }`}
            >
              <KeyRound className="h-3.5 w-3.5" />
              <span>自定义 API Key</span>
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.2 text-[10px] text-emerald-600 dark:text-emerald-400">
                不扣积分
              </span>
            </button>
          </div>

          {mode === "system" ? (
            <div className="space-y-4">
              {systemModel.available ? (
                <div className="rounded-xl border border-violet-500/25 bg-violet-500/6 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                      <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                        系统托管模型已就绪
                      </span>
                    </div>
                    <span className="rounded-md bg-white/80 dark:bg-zinc-900/90 border border-zinc-200 dark:border-zinc-800 px-2 py-0.5 text-[11px] font-mono text-violet-600 dark:text-violet-300">
                      {systemProviderName} · {systemModel.model}
                    </span>
                  </div>

                  <div className="rounded-lg border border-zinc-200/70 dark:border-zinc-800/80 bg-white/70 dark:bg-zinc-900/60 p-3 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                        <Coins className="h-3.5 w-3.5 text-amber-500" />
                        当前积分余额
                      </span>
                      <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-100">
                        {credits
                          ? `${credits.balance} 积分`
                          : !user
                            ? "未登录"
                            : billingLoading
                              ? "加载中…"
                              : "--"}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed pt-1 border-t border-zinc-200/60 dark:border-zinc-800/70">
                      按实际 Token 用量折算扣费（1 积分对应）：正常输入{" "}
                      <strong className="text-zinc-700 dark:text-zinc-200">
                        {systemModel.inputTokensPerCredit.toLocaleString()}
                      </strong>
                      、缓存命中{" "}
                      <strong className="text-emerald-600 dark:text-emerald-400">
                        {systemModel.cachedInputTokensPerCredit.toLocaleString()}
                      </strong>
                      、缓存写入{" "}
                      <strong className="text-zinc-700 dark:text-zinc-200">
                        {systemModel.cacheWriteTokensPerCredit.toLocaleString()}
                      </strong>
                      、输出{" "}
                      <strong className="text-zinc-700 dark:text-zinc-200">
                        {systemModel.outputTokensPerCredit.toLocaleString()}
                      </strong>{" "}
                      tokens（单次最低 {systemModel.minCreditsPerRun} 积分）。新注册用户默认赠送{" "}
                      {systemModel.initialCredits} 积分。
                    </p>
                  </div>

                  {credits && credits.balance < systemModel.minCreditsPerRun && (
                    <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-600 dark:text-rose-300">
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>
                        当前积分为 0，无法继续使用系统模型。你可以切换到上方「自定义
                        API Key」继续免费使用。
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <div className="font-semibold">服务端尚未配置系统默认模型</div>
                    <p className="text-[11px] opacity-90 leading-relaxed">
                      管理员需在环境变量中配置{" "}
                      <code className="font-mono">SYSTEM_MODEL_API_KEY</code> 等参数。你现在可以切换到「自定义
                      API Key」立即开始使用。
                    </p>
                  </div>
                </div>
              )}

              {/* Max Iterations Slider */}
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
            </div>
          ) : (
            <>
              {/* Provider Presets */}
              <div>
                <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-2">
                  服务商预设
                </label>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
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
                    API Key 仅保存在当前浏览器本地，不会被服务端存储，且不消耗平台积分。
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
                  placeholder="例如 gpt-6.2-sol / gemini-4-hydrogen / deepseek-v4-pro"
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

              {/* Max Iterations Slider */}
              <div className="pt-1">
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
            </>
          )}

          {/* Footer Actions */}
          <div className="flex items-center justify-between pt-2 border-t border-zinc-200 dark:border-zinc-800">
            {mode === "custom" ? (
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={
                  testing || !draft.apiKey.trim() || !draft.baseUrl.trim()
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 px-3.5 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {testing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <PlugZap className="h-3.5 w-3.5" />
                )}
                测试连接
              </button>
            ) : (
              <span className="text-[11px] text-zinc-400">
                {systemModel.available
                  ? "使用服务端托管默认模型"
                  : "需配置服务端系统模型或使用自定义 Key"}
              </span>
            )}

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
                {mode === "system" ? "使用系统默认" : "保存配置"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
