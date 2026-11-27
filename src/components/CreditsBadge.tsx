"use client";

import React, { useEffect, useRef, useState } from "react";
import { Coins, Gift, RefreshCw, Sparkles } from "lucide-react";
import { useBilling } from "./BillingProvider";

function formatTokens(n: number): string {
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}k`;
  }
  return String(n);
}

function formatTime(ts: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return "刚刚";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} 小时前`;
  return new Date(ts).toLocaleDateString("zh-CN");
}

export function CreditsBadge() {
  const { systemModel, credits, recentTransactions, loading, refreshBilling } =
    useBilling();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  if (!credits) return null;

  const isLow = credits.balance <= 10;
  const isEmpty = credits.balance <= 0;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) void refreshBilling();
        }}
        title="查看积分余额与消耗明细"
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
          isEmpty
            ? "border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-300 hover:bg-rose-500/15"
            : isLow
              ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/15"
              : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 hover:border-violet-500/50"
        }`}
      >
        <Coins
          className={`h-3.5 w-3.5 shrink-0 ${
            isEmpty
              ? "text-rose-500"
              : isLow
                ? "text-amber-500"
                : "text-amber-500"
          }`}
        />
        <span className="font-mono text-[11px]">{credits.balance}</span>
        <span className="hidden md:inline text-[11px] text-zinc-500 dark:text-zinc-400">
          积分
        </span>
      </button>

      {open && (
        <div className="absolute right-0 mt-1.5 w-80 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#141418] shadow-2xl p-3.5 z-50">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              <Coins className="h-3.5 w-3.5 text-amber-500" />
              <span>我的积分</span>
            </div>
            <button
              type="button"
              onClick={() => void refreshBilling()}
              disabled={loading}
              title="刷新积分"
              className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
            >
              <RefreshCw
                className={`h-3 w-3 ${loading ? "animate-spin" : ""}`}
              />
            </button>
          </div>

          {/* Summary Card */}
          <div className="mt-2.5 rounded-xl border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/70 p-3">
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                当前可用余额
              </span>
              <span className="text-2xl font-bold font-mono tracking-tight text-zinc-900 dark:text-zinc-50">
                {credits.balance}
                <span className="ml-1 text-xs font-normal text-zinc-400">
                  积分
                </span>
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-400 border-t border-zinc-200/70 dark:border-zinc-800 pt-2">
              <span>累计赠送：{credits.totalGranted}</span>
              <span>累计消耗：{credits.totalSpent}</span>
            </div>
          </div>

          {/* Billing Rate Note */}
          <div className="mt-2.5 rounded-lg bg-violet-500/8 border border-violet-500/20 px-2.5 py-2 text-[11px] text-zinc-600 dark:text-zinc-300 leading-relaxed">
            <div className="font-medium text-violet-600 dark:text-violet-300 flex items-center gap-1">
              <Sparkles className="h-3 w-3" />
              系统模型按 Token 计费规则
            </div>
            <p className="mt-0.5 text-[10px] text-zinc-500 dark:text-zinc-400">
              正常输入 {systemModel.inputTokensPerCredit.toLocaleString()}、缓存命中{" "}
              {systemModel.cachedInputTokensPerCredit.toLocaleString()}、缓存写入{" "}
              {systemModel.cacheWriteTokensPerCredit.toLocaleString()}、输出{" "}
              {systemModel.outputTokensPerCredit.toLocaleString()} tokens/积分（单次最低{" "}
              {systemModel.minCreditsPerRun} 积分）；自定义 API Key 不扣积分。
            </p>
          </div>

          {/* Recent Ledger */}
          <div className="mt-3">
            <div className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
              最近明细
            </div>
            {recentTransactions.length === 0 ? (
              <div className="py-4 text-center text-[11px] text-zinc-400">
                暂无积分变动记录
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto space-y-1 pr-0.5">
                {recentTransactions.map((tx) => {
                  const isBonus = tx.delta > 0;
                  const totalTokens =
                    tx.inputTokens +
                    tx.cachedInputTokens +
                    tx.cacheWriteTokens +
                    tx.outputTokens;
                  return (
                    <div
                      key={tx.id}
                      className="flex items-start justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-zinc-100/80 dark:hover:bg-zinc-800/60 transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1 text-[11px] font-medium text-zinc-800 dark:text-zinc-200 truncate">
                          {isBonus && (
                            <Gift className="h-3 w-3 text-emerald-500 shrink-0" />
                          )}
                          <span className="truncate">
                            {tx.reason === "signup_bonus"
                              ? "新用户注册赠送"
                              : tx.model || "系统模型调用"}
                          </span>
                        </div>
                        <div className="text-[10px] text-zinc-400 mt-0.5">
                          {totalTokens > 0
                            ? `${formatTokens(totalTokens)} tokens${
                                tx.cachedInputTokens > 0
                                  ? ` (含缓存 ${formatTokens(tx.cachedInputTokens)})`
                                  : ""
                              } · `
                            : ""}
                          {formatTime(tx.createdAt)}
                        </div>
                      </div>
                      <span
                        className={`shrink-0 font-mono text-xs font-semibold ${
                          isBonus
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-zinc-700 dark:text-zinc-300"
                        }`}
                      >
                        {isBonus ? `+${tx.delta}` : tx.delta}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
