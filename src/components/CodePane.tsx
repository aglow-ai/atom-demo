"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Check,
  Copy,
  FileCode2,
  FileJson,
  FileText,
  FolderOpen,
  Lock,
} from "lucide-react";
import type { ProjectFiles } from "@/lib/types";

interface CodePaneProps {
  files: ProjectFiles;
  activeFile: string | null;
  onSelectFile: (path: string) => void;
}

function getFileIcon(path: string) {
  if (path.endsWith(".json")) return FileJson;
  if (path.endsWith(".css")) return FileText;
  return FileCode2;
}

const TOKEN_REGEX =
  /(\/\/.*$|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:import|export|from|default|function|const|let|var|return|if|else|for|while|switch|case|break|continue|try|catch|finally|throw|new|async|await|type|interface|extends|implements|as|true|false|null|undefined|typeof|keyof|void)\b|\b\d+(?:\.\d+)?\b|<\/?[A-Za-z][A-Za-z0-9.-]*)/gm;

function highlightLine(line: string): React.ReactNode[] {
  if (!line) return ["\n"];
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  TOKEN_REGEX.lastIndex = 0;

  while ((match = TOKEN_REGEX.exec(line)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(line.slice(lastIndex, match.index));
    }
    const token = match[0];
    let className = "";

    if (token.startsWith("//") || token.startsWith("/*")) {
      className = "text-zinc-400 dark:text-zinc-500 italic";
    } else if (
      token.startsWith('"') ||
      token.startsWith("'") ||
      token.startsWith("`")
    ) {
      className = "text-emerald-600 dark:text-emerald-400";
    } else if (token.startsWith("<")) {
      className = "text-sky-600 dark:text-sky-400";
    } else if (/^\d/.test(token)) {
      className = "text-amber-600 dark:text-amber-400";
    } else {
      className = "text-violet-600 dark:text-violet-400 font-medium";
    }

    nodes.push(
      <span key={`${match.index}-${token}`} className={className}>
        {token}
      </span>
    );
    lastIndex = match.index + token.length;
  }

  if (lastIndex < line.length) {
    nodes.push(line.slice(lastIndex));
  }
  return nodes;
}

export function CodePane({
  files,
  activeFile,
  onSelectFile,
}: CodePaneProps) {
  const filePaths = useMemo(() => Object.keys(files).sort(), [files]);
  const [copied, setCopied] = useState(false);

  const currentFile =
    activeFile && activeFile in files ? activeFile : filePaths[0] ?? null;

  useEffect(() => {
    if (currentFile && currentFile !== activeFile) {
      onSelectFile(currentFile);
    }
  }, [currentFile, activeFile, onSelectFile]);

  const currentContent = currentFile ? files[currentFile] ?? "" : "";
  const lines = useMemo(() => currentContent.split("\n"), [currentContent]);

  const handleCopy = async () => {
    if (!currentContent) return;
    try {
      await navigator.clipboard.writeText(currentContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore
    }
  };

  if (filePaths.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-zinc-50 dark:bg-[#09090b] p-8 text-center">
        <FileCode2 className="h-10 w-10 text-zinc-400 mb-3" />
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          暂无生成的代码文件
        </p>
        <p className="mt-1 text-xs text-zinc-500 max-w-xs leading-relaxed">
          在左侧输入应用需求后，智能体生成的多文件源码将实时展示在此处供查阅和复制。
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full bg-white dark:bg-[#09090b] overflow-hidden">
      {/* File Explorer Sidebar (Read-only) */}
      <div className="w-52 shrink-0 border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-[#0e0e11] flex flex-col">
        <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">
            <FolderOpen className="h-3.5 w-3.5 text-violet-500" />
            <span>项目文件 ({filePaths.length})</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
          {filePaths.map((path) => {
            const Icon = getFileIcon(path);
            const active = path === currentFile;
            return (
              <button
                key={path}
                type="button"
                onClick={() => onSelectFile(path)}
                className={`w-full flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-left transition-colors ${
                  active
                    ? "bg-violet-500/15 text-violet-700 dark:text-violet-300 font-medium"
                    : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60"
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0 opacity-75" />
                <span className="truncate font-mono text-[11px]" title={path}>
                  {path}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Read-Only Code Viewer */}
      <div className="flex-1 flex flex-col min-w-0">
        {currentFile && (
          <>
            <div className="flex items-center justify-between px-3.5 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111114]">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono text-xs text-zinc-700 dark:text-zinc-200 truncate">
                  {currentFile}
                </span>
                <span className="rounded bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-[10px] font-mono text-zinc-500">
                  {lines.length} 行
                </span>
                <span className="hidden sm:inline-flex items-center gap-1 rounded bg-zinc-100 dark:bg-zinc-800/80 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:text-zinc-400">
                  <Lock className="h-2.5 w-2.5" />
                  只读
                </span>
              </div>
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1 rounded-md border border-zinc-200 dark:border-zinc-800 px-2 py-1 text-[11px] text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                {copied ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-500" />
                    已复制
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    复制代码
                  </>
                )}
              </button>
            </div>

            <div className="flex-1 overflow-auto bg-zinc-50 dark:bg-[#09090b]">
              <pre className="m-0 py-3 font-mono text-xs leading-6 text-zinc-800 dark:text-zinc-200">
                <code>
                  {lines.map((line, i) => (
                    <div
                      key={i}
                      className="flex hover:bg-zinc-200/40 dark:hover:bg-zinc-800/35 px-3"
                    >
                      <span className="select-none w-10 shrink-0 pr-3 text-right text-zinc-400/70">
                        {i + 1}
                      </span>
                      <span className="whitespace-pre flex-1">
                        {highlightLine(line)}
                      </span>
                    </div>
                  ))}
                </code>
              </pre>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
