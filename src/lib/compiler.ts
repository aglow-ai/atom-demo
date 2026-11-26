import { transform } from "sucrase";
import type { CompileError, CompileResult, ProjectFiles } from "./types";

const CODE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];
const ENTRY_CANDIDATES = [
  "src/App.tsx",
  "src/App.jsx",
  "src/App.ts",
  "src/App.js",
  "App.tsx",
  "App.jsx",
];

export function normalizePath(filePath: string): string {
  return filePath
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/");
}

function dirname(filePath: string): string {
  const idx = filePath.lastIndexOf("/");
  return idx === -1 ? "" : filePath.slice(0, idx);
}

function resolvePosixPath(baseDir: string, relativePath: string): string {
  const parts = (baseDir ? baseDir.split("/") : []).concat(
    relativePath.split("/")
  );
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  return stack.join("/");
}

export function resolveLocalFile(
  importerPath: string,
  specifier: string,
  normalizedFiles: ProjectFiles
): string | null {
  let baseCandidate = "";
  if (specifier.startsWith("@/")) {
    baseCandidate = "src/" + specifier.slice(2);
  } else if (specifier.startsWith("/")) {
    baseCandidate = normalizePath(specifier);
  } else {
    baseCandidate = resolvePosixPath(dirname(importerPath), specifier);
  }

  const candidates = [
    baseCandidate,
    ...CODE_EXTENSIONS.map((ext) => `${baseCandidate}${ext}`),
    `${baseCandidate}.json`,
    `${baseCandidate}.css`,
    ...CODE_EXTENSIONS.map((ext) => `${baseCandidate}/index${ext}`),
  ];

  for (const candidate of candidates) {
    if (candidate in normalizedFiles) {
      return candidate;
    }
  }
  return null;
}

function isLocalSpecifier(specifier: string): boolean {
  return (
    specifier.startsWith("./") ||
    specifier.startsWith("../") ||
    specifier.startsWith("@/") ||
    specifier.startsWith("/")
  );
}

function isCssSpecifier(specifier: string): boolean {
  return specifier.toLowerCase().endsWith(".css");
}

function rewriteImports(
  code: string,
  filePath: string,
  normalizedFiles: ProjectFiles,
  errors: CompileError[],
  externalPackages: Set<string>
): string {
  // Remove side-effect CSS imports (all .css files are bundled into <style>)
  let output = code.replace(
    /^\s*import\s+["']([^"']+\.css)["']\s*;?\s*$/gm,
    "/* css import bundled */"
  );

  const rewriteSpecifier = (specifier: string): string => {
    if (
      specifier.startsWith("http://") ||
      specifier.startsWith("https://") ||
      specifier.startsWith("data:")
    ) {
      return specifier;
    }

    if (isCssSpecifier(specifier)) {
      return specifier;
    }

    if (isLocalSpecifier(specifier)) {
      const resolved = resolveLocalFile(filePath, specifier, normalizedFiles);
      if (!resolved) {
        errors.push({
          file: filePath,
          message: `无法解析本地导入 "${specifier}"，请确认目标文件已创建。`,
        });
        return specifier;
      }
      if (resolved.endsWith(".css")) {
        return specifier;
      }
      return `@vfs/${resolved}`;
    }

    externalPackages.add(specifier);
    return specifier;
  };

  // Static import/export ... from 'specifier'
  output = output.replace(
    /(\b(?:import|export)\b[\s\S]*?\bfrom\s*)(["'])([^"']+)\2/g,
    (match, prefix: string, quote: string, specifier: string) => {
      const nextSpec = rewriteSpecifier(specifier);
      return `${prefix}${quote}${nextSpec}${quote}`;
    }
  );

  // Side-effect static imports: import 'specifier'
  output = output.replace(
    /(^\s*import\s*)(["'])([^"']+)\2/gm,
    (match, prefix: string, quote: string, specifier: string) => {
      if (isCssSpecifier(specifier)) return "/* css import bundled */";
      const nextSpec = rewriteSpecifier(specifier);
      return `${prefix}${quote}${nextSpec}${quote}`;
    }
  );

  // Dynamic import('specifier')
  output = output.replace(
    /(\bimport\s*\(\s*)(["'])([^"']+)\2(\s*\))/g,
    (match, pre: string, quote: string, specifier: string, post: string) => {
      const nextSpec = rewriteSpecifier(specifier);
      return `${pre}${quote}${nextSpec}${quote}${post}`;
    }
  );

  return output;
}

export function normalizeProjectFiles(files: ProjectFiles): ProjectFiles {
  const normalized: ProjectFiles = {};
  for (const [rawPath, content] of Object.entries(files)) {
    const p = normalizePath(rawPath);
    if (p) {
      normalized[p] = content;
    }
  }
  return normalized;
}

export function findEntryFile(normalizedFiles: ProjectFiles): string | null {
  for (const candidate of ENTRY_CANDIDATES) {
    if (candidate in normalizedFiles) {
      return candidate;
    }
  }
  // Fallback: any file ending with App.tsx / App.jsx
  const fallback = Object.keys(normalizedFiles).find((p) =>
    /(^|\/)App\.(tsx|jsx|ts|js)$/i.test(p)
  );
  return fallback ?? null;
}

export function compileProject(rawFiles: ProjectFiles): CompileResult {
  const normalizedFiles = normalizeProjectFiles(rawFiles);
  const errors: CompileError[] = [];
  const warnings: string[] = [];
  const compiledModules: Record<string, string> = {};
  const externalPackages = new Set<string>();
  const cssChunks: string[] = [];

  const filePaths = Object.keys(normalizedFiles).sort();
  if (filePaths.length === 0) {
    return {
      ok: false,
      entryFile: null,
      compiledModules,
      cssContent: "",
      externalPackages: [],
      errors: [{ file: "src/App.tsx", message: "项目当前没有任何文件。" }],
      warnings,
    };
  }

  const entryFile = findEntryFile(normalizedFiles);
  if (!entryFile) {
    errors.push({
      file: "src/App.tsx",
      message: "缺少入口文件 src/App.tsx，请创建并默认导出 React 根组件。",
    });
  }

  for (const filePath of filePaths) {
    const source = normalizedFiles[filePath] ?? "";

    // Check accidental markdown fences inside files
    if (/^\s*```[a-zA-Z]*\s*$/m.test(source)) {
      errors.push({
        file: filePath,
        message: "文件中包含残留的 Markdown 代码块标记 (```)，请清理为纯源码。",
      });
      continue;
    }

    if (filePath.endsWith(".css")) {
      cssChunks.push(`/* === ${filePath} === */\n${source}`);
      continue;
    }

    if (filePath.endsWith(".json")) {
      try {
        JSON.parse(source);
        compiledModules[filePath] = `export default ${source};`;
      } catch (err) {
        errors.push({
          file: filePath,
          message: `JSON 解析失败: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      continue;
    }

    const isTs = filePath.endsWith(".ts") || filePath.endsWith(".tsx");
    const isJsx = filePath.endsWith(".tsx") || filePath.endsWith(".jsx");
    const isJs = filePath.endsWith(".js") || filePath.endsWith(".mjs");

    if (!isTs && !isJsx && !isJs) {
      continue;
    }

    try {
      const transforms: ("typescript" | "jsx")[] = [];
      if (isTs) transforms.push("typescript");
      if (isJsx || isJs) transforms.push("jsx");

      const result = transform(source, {
        transforms,
        jsxRuntime: "automatic",
        production: true,
        filePath,
      });

      const rewritten = rewriteImports(
        result.code,
        filePath,
        normalizedFiles,
        errors,
        externalPackages
      );

      compiledModules[filePath] = rewritten;
    } catch (err) {
      const errObj = err as Error & { loc?: { line?: number; column?: number } };
      errors.push({
        file: filePath,
        message: errObj.message || "语法编译错误",
        line: errObj.loc?.line,
        column: errObj.loc?.column,
      });
    }
  }

  if (entryFile && compiledModules[entryFile]) {
    const entryCode = compiledModules[entryFile];
    const hasExport =
      /\bexport\s+default\b/.test(entryCode) ||
      /\bexport\s+(?:function|const|class)\s+App\b/.test(entryCode) ||
      /\bexport\s*\{[^}]*\b(default|App)\b[^}]*\}/.test(entryCode);
    if (!hasExport) {
      errors.push({
        file: entryFile,
        message: `入口文件 ${entryFile} 必须包含 export default 或 export function App。`,
      });
    }
  }

  return {
    ok: errors.length === 0,
    entryFile,
    compiledModules,
    cssContent: cssChunks.join("\n\n"),
    externalPackages: Array.from(externalPackages).sort(),
    errors,
    warnings,
  };
}
