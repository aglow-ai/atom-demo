import JSZip from "jszip";
import { buildPreviewHtml } from "./preview-builder";
import type { ProjectFiles } from "./types";

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeFileSlug(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "atoms-app";
}

export function exportStandaloneHtml(
  projectName: string,
  files: ProjectFiles
): void {
  const { html } = buildPreviewHtml(files, {
    title: projectName,
    standalone: true,
  });
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  triggerDownload(blob, `${safeFileSlug(projectName)}.html`);
}

export async function exportProjectZip(
  projectName: string,
  files: ProjectFiles
): Promise<void> {
  const zip = new JSZip();
  const slug = safeFileSlug(projectName);

  const packageJson = {
    name: slug.replace(/[\u4e00-\u9fa5]/g, "app") || "atoms-app",
    private: true,
    version: "0.1.0",
    type: "module",
    scripts: {
      dev: "vite",
      build: "vite build",
      preview: "vite preview",
    },
    dependencies: {
      react: "^18.3.1",
      "react-dom": "^18.3.1",
      "lucide-react": "^0.469.0",
      recharts: "^2.15.0",
      "framer-motion": "^11.15.0",
      clsx: "^2.1.1",
      "tailwind-merge": "^2.6.0",
    },
    devDependencies: {
      "@types/react": "^18.3.12",
      "@types/react-dom": "^18.3.1",
      "@vitejs/plugin-react": "^4.3.4",
      typescript: "^5.6.3",
      vite: "^6.0.0",
    },
  };

  zip.file("package.json", JSON.stringify(packageJson, null, 2));
  zip.file(
    "index.html",
    `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${projectName}</title>
    <script src="https://cdn.tailwindcss.com"></script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`
  );
  zip.file(
    "vite.config.ts",
    `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
`
  );
  zip.file(
    "src/main.tsx",
    `import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
${"src/styles.css" in files ? 'import "./styles.css";\n' : ""}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`
  );

  for (const [filePath, content] of Object.entries(files)) {
    zip.file(filePath, content);
  }

  const blob = await zip.generateAsync({ type: "blob" });
  triggerDownload(blob, `${slug}.zip`);
}
