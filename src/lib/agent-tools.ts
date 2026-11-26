import { compileProject, normalizePath } from "./compiler";
import type { ProjectFiles } from "./types";

export interface OpenAIToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

export const AGENT_TOOLS: OpenAIToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "list_files",
      description:
        "列出当前虚拟项目中的所有文件路径及行数。在对已有项目进行修改前应先调用此工具了解项目结构。",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "读取指定文件的完整源码内容，附带行号以便精确编辑。",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "相对于项目根目录的文件路径，例如 src/App.tsx",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "创建新文件或完整覆盖已有文件。请写入纯净的源码，禁止包含 Markdown 代码块标记 (```)。入口组件必须位于 src/App.tsx 并提供 default export。",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "文件路径，例如 src/App.tsx、src/components/Header.tsx、src/styles.css",
          },
          content: {
            type: "string",
            description: "文件的完整源代码内容",
          },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description:
        "在已有文件中执行精确的字符串替换，用于局部修改代码，比重写整个文件更高效。",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "要修改的文件路径，例如 src/App.tsx",
          },
          search: {
            type: "string",
            description: "文件中必须精确匹配的原始代码片段（包含空格与缩进）",
          },
          replace: {
            type: "string",
            description: "替换后的新代码片段",
          },
        },
        required: ["path", "search", "replace"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_file",
      description: "从项目中删除不再需要的文件。",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "要删除的文件路径",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "validate_project",
      description:
        "对整个项目执行 TypeScript/JSX 编译校验与本地模块导入检查。每次完成代码编写或修改后必须调用此工具；若返回错误，请根据报错信息修复后再次校验，直到通过。",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
];

export interface ToolExecutionOutcome {
  ok: boolean;
  output: string;
  mutatedFile?: string;
}

export function executeAgentTool(
  toolName: string,
  args: Record<string, unknown>,
  files: ProjectFiles
): ToolExecutionOutcome {
  switch (toolName) {
    case "list_files": {
      const paths = Object.keys(files).sort();
      if (paths.length === 0) {
        return {
          ok: true,
          output: "当前项目为空，尚无任何文件。",
        };
      }
      const lines = paths.map((p) => {
        const lineCount = files[p].split("\n").length;
        return `- ${p} (${lineCount} lines, ${files[p].length} chars)`;
      });
      return {
        ok: true,
        output: `项目文件列表（共 ${paths.length} 个）：\n${lines.join("\n")}`,
      };
    }

    case "read_file": {
      const path = normalizePath(String(args.path ?? ""));
      if (!path) {
        return { ok: false, output: "错误：缺少 path 参数。" };
      }
      if (!(path in files)) {
        return {
          ok: false,
          output: `错误：文件 "${path}" 不存在。现有文件：${
            Object.keys(files).sort().join(", ") || "无"
          }`,
        };
      }
      const numbered = files[path]
        .split("\n")
        .map((line, i) => `${i + 1}: ${line}`)
        .join("\n");
      return {
        ok: true,
        output: `=== ${path} ===\n${numbered}`,
      };
    }

    case "write_file": {
      const path = normalizePath(String(args.path ?? ""));
      const content = typeof args.content === "string" ? args.content : "";
      if (!path) {
        return { ok: false, output: "错误：缺少有效的 path 参数。" };
      }
      const existed = path in files;
      files[path] = content;
      const lineCount = content.split("\n").length;
      return {
        ok: true,
        output: `${existed ? "已更新" : "已创建"}文件 ${path}（${lineCount} 行）。`,
        mutatedFile: path,
      };
    }

    case "edit_file": {
      const path = normalizePath(String(args.path ?? ""));
      const search = typeof args.search === "string" ? args.search : "";
      const replace = typeof args.replace === "string" ? args.replace : "";
      if (!path || !(path in files)) {
        return {
          ok: false,
          output: `错误：目标文件 "${path}" 不存在，请先使用 list_files 确认路径或用 write_file 创建。`,
        };
      }
      if (!search) {
        return { ok: false, output: "错误：search 参数不能为空。" };
      }
      const original = files[path];
      const idx = original.indexOf(search);
      if (idx === -1) {
        return {
          ok: false,
          output: `错误：在 ${path} 中未找到完全匹配的 search 代码片段。请先调用 read_file 查看最新内容，或直接使用 write_file 覆写。`,
        };
      }
      const secondIdx = original.indexOf(search, idx + search.length);
      if (secondIdx !== -1) {
        return {
          ok: false,
          output: `错误：search 代码片段在 ${path} 中出现了多次，请提供更多上下文行以精确定位。`,
        };
      }
      files[path] =
        original.slice(0, idx) + replace + original.slice(idx + search.length);
      return {
        ok: true,
        output: `已成功修改 ${path}（替换 1 处）。`,
        mutatedFile: path,
      };
    }

    case "delete_file": {
      const path = normalizePath(String(args.path ?? ""));
      if (!path || !(path in files)) {
        return {
          ok: false,
          output: `错误：文件 "${path}" 不存在。`,
        };
      }
      delete files[path];
      return {
        ok: true,
        output: `已删除文件 ${path}。`,
        mutatedFile: path,
      };
    }

    case "validate_project": {
      const result = compileProject(files);
      if (result.ok) {
        return {
          ok: true,
          output: `校验通过！入口文件：${result.entryFile}，共编译 ${
            Object.keys(result.compiledModules).length
          } 个代码模块，外部依赖：${
            result.externalPackages.join(", ") || "无"
          }。零语法或导入错误。`,
        };
      }
      const errorLines = result.errors.map(
        (e, i) =>
          `${i + 1}. [${e.file}${e.line ? `:${e.line}` : ""}] ${e.message}`
      );
      return {
        ok: false,
        output: `校验未通过，发现 ${result.errors.length} 个错误：\n${errorLines.join(
          "\n"
        )}\n请根据以上报错修复对应文件，并再次调用 validate_project。`,
      };
    }

    default:
      return {
        ok: false,
        output: `未知工具：${toolName}`,
      };
  }
}
