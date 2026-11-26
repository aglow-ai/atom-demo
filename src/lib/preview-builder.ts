import { compileProject } from "./compiler";
import type { CompileResult, ProjectFiles } from "./types";

const REACT_VERSION = "18.3.1";

const BASE_IMPORT_MAP: Record<string, string> = {
  react: `https://esm.sh/react@${REACT_VERSION}`,
  "react-dom": `https://esm.sh/react-dom@${REACT_VERSION}`,
  "react-dom/client": `https://esm.sh/react-dom@${REACT_VERSION}/client`,
  "react/jsx-runtime": `https://esm.sh/react@${REACT_VERSION}/jsx-runtime`,
  "react/jsx-dev-runtime": `https://esm.sh/react@${REACT_VERSION}/jsx-dev-runtime`,
  "lucide-react": `https://esm.sh/lucide-react@0.469.0?deps=react@${REACT_VERSION}`,
  recharts: `https://esm.sh/recharts@2.15.0?deps=react@${REACT_VERSION},react-dom@${REACT_VERSION}`,
  "framer-motion": `https://esm.sh/framer-motion@11.15.0?deps=react@${REACT_VERSION},react-dom@${REACT_VERSION}`,
  clsx: "https://esm.sh/clsx@2.1.1",
  "tailwind-merge": "https://esm.sh/tailwind-merge@2.6.0",
  "canvas-confetti": "https://esm.sh/canvas-confetti@1.9.3",
  "date-fns": "https://esm.sh/date-fns@4.1.0",
};

function toUtf8Base64(text: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(text, "utf-8").toString("base64");
  }
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function safeJsonForScript(obj: unknown): string {
  return JSON.stringify(obj, null, 2).replace(/</g, "\\u003c");
}

function escapeStyleTag(css: string): string {
  return css.replace(/<\/style/gi, "<\\/style");
}

function buildImportMap(result: CompileResult): Record<string, string> {
  const imports: Record<string, string> = { ...BASE_IMPORT_MAP };

  // Auto-resolve any additional bare npm specifiers via esm.sh pinned to React 18
  for (const pkg of result.externalPackages) {
    if (!imports[pkg] && !pkg.startsWith("@vfs/")) {
      imports[pkg] = `https://esm.sh/${pkg}?deps=react@${REACT_VERSION},react-dom@${REACT_VERSION}`;
    }
  }

  // Register compiled local project files as UTF-8 base64 data: ESM modules
  for (const [filePath, code] of Object.entries(result.compiledModules)) {
    const b64 = toUtf8Base64(code);
    imports[`@vfs/${filePath}`] = `data:text/javascript;base64,${b64}`;
  }

  return imports;
}

export interface PreviewBuildOutput {
  html: string;
  compileResult: CompileResult;
}

export function buildPreviewHtml(
  files: ProjectFiles,
  options?: { title?: string; standalone?: boolean }
): PreviewBuildOutput {
  const compileResult = compileProject(files);
  const title = options?.title || "Atoms Preview";
  const standalone = Boolean(options?.standalone);

  if (!compileResult.ok || !compileResult.entryFile) {
    const errorItems = compileResult.errors
      .map(
        (e) =>
          `<li style="margin-bottom:8px;"><strong>${escapeHtml(e.file)}</strong>${
            e.line ? ` (Line ${e.line})` : ""
          }: ${escapeHtml(e.message)}</li>`
      )
      .join("");

    const errorHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)} - 编译错误</title>
</head>
<body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#09090b;color:#f4f4f5;">
  <div style="max-width:680px;margin:24px auto;border:1px solid rgba(239,68,68,0.35);background:rgba(239,68,68,0.08);border-radius:12px;padding:20px;">
    <h2 style="margin:0 0 12px;font-size:16px;color:#fca5a5;">代码编译失败</h2>
    <ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.6;color:#fecaca;">${errorItems}</ul>
  </div>
</body>
</html>`;
    return { html: errorHtml, compileResult };
  }

  const importMap = buildImportMap(compileResult);
  const entrySpecifier = `@vfs/${compileResult.entryFile}`;

  const errorReporterScript = standalone
    ? ""
    : `
  <script>
    (function() {
      function sendError(payload) {
        try {
          window.parent.postMessage({ __atomsPreviewError: true, payload: payload }, "*");
        } catch (_) {}
      }
      window.addEventListener("error", function(event) {
        sendError({
          type: "runtime",
          message: event.message || "Unknown runtime error",
          stack: event.error && event.error.stack ? String(event.error.stack) : "",
          source: event.filename || "",
          line: event.lineno || undefined,
          col: event.colno || undefined,
          timestamp: Date.now()
        });
      });
      window.addEventListener("unhandledrejection", function(event) {
        var reason = event.reason;
        var message = reason && reason.message ? reason.message : String(reason || "Unhandled Promise Rejection");
        var stack = reason && reason.stack ? String(reason.stack) : "";
        sendError({
          type: "unhandledrejection",
          message: message,
          stack: stack,
          timestamp: Date.now()
        });
      });
      var origError = console.error;
      console.error = function() {
        origError.apply(console, arguments);
        try {
          var parts = Array.prototype.slice.call(arguments).map(function(arg) {
            if (arg instanceof Error) return arg.message + "\\n" + (arg.stack || "");
            if (typeof arg === "object") {
              try { return JSON.stringify(arg); } catch (_) { return String(arg); }
            }
            return String(arg);
          });
          var msg = parts.join(" ");
          if (msg && !msg.includes("Download the React DevTools")) {
            sendError({
              type: "console",
              message: msg.slice(0, 1200),
              timestamp: Date.now()
            });
          }
        } catch (_) {}
      };
      window.__ATOMS_REPORT_REACT_ERROR__ = function(error, info) {
        sendError({
          type: "react",
          message: (error && error.message) ? error.message : String(error),
          stack: (error && error.stack ? error.stack : "") + (info && info.componentStack ? "\\n" + info.componentStack : ""),
          timestamp: Date.now()
        });
      };
    })();
  </script>`;

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    html, body, #root {
      height: 100%;
      margin: 0;
    }
    ${escapeStyleTag(compileResult.cssContent)}
  </style>
  <script type="importmap">
${safeJsonForScript({ imports: importMap })}
  </script>${errorReporterScript}
</head>
<body>
  <div id="root"></div>
  <script type="module">
    import React from "react";
    import { createRoot } from "react-dom/client";

    class AtomsErrorBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
      }
      static getDerivedStateFromError(error) {
        return { hasError: true, error };
      }
      componentDidCatch(error, info) {
        if (typeof window.__ATOMS_REPORT_REACT_ERROR__ === "function") {
          window.__ATOMS_REPORT_REACT_ERROR__(error, info);
        }
      }
      render() {
        if (this.state.hasError) {
          return React.createElement(
            "div",
            {
              style: {
                minHeight: "100vh",
                padding: "24px",
                background: "#09090b",
                color: "#f4f4f5",
                fontFamily: "system-ui, -apple-system, sans-serif",
              },
            },
            React.createElement(
              "div",
              {
                style: {
                  maxWidth: "640px",
                  margin: "24px auto",
                  padding: "20px",
                  borderRadius: "12px",
                  border: "1px solid rgba(239,68,68,0.4)",
                  background: "rgba(239,68,68,0.08)",
                },
              },
              React.createElement("h2", { style: { margin: "0 0 8px", fontSize: "16px", color: "#fca5a5" } }, "应用运行时错误"),
              React.createElement("pre", { style: { margin: 0, whiteSpace: "pre-wrap", fontSize: "12px", color: "#fecaca" } }, String(this.state.error?.stack || this.state.error?.message || this.state.error))
            )
          );
        }
        return this.props.children;
      }
    }

    async function boot() {
      try {
        const mod = await import(${JSON.stringify(entrySpecifier)});
        const AppComponent = mod.default || mod.App;
        if (!AppComponent) {
          throw new Error("入口文件未导出有效的 React 组件 (export default 或 export function App)。");
        }
        const rootEl = document.getElementById("root");
        const root = createRoot(rootEl);
        root.render(
          React.createElement(
            React.StrictMode,
            null,
            React.createElement(AtomsErrorBoundary, null, React.createElement(AppComponent))
          )
        );
        try {
          window.parent.postMessage({ __atomsPreviewReady: true }, "*");
        } catch (_) {}
      } catch (err) {
        if (typeof window.__ATOMS_REPORT_REACT_ERROR__ === "function") {
          window.__ATOMS_REPORT_REACT_ERROR__(err, {});
        }
        const rootEl = document.getElementById("root");
        if (rootEl) {
          rootEl.innerHTML = '<div style="padding:24px;font-family:system-ui,sans-serif;background:#09090b;color:#fecaca;min-height:100vh;"><h3>模块加载失败</h3><pre style="white-space:pre-wrap;font-size:12px;">' + String(err?.stack || err?.message || err).replace(/</g, "&lt;") + '</pre></div>';
        }
      }
    }

    boot();
  </script>
</body>
</html>`;

  return { html, compileResult };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
