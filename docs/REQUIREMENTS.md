# Atoms Demo 初始需求规格与技术设计方案（v1 PRD）

> 本文档记录项目启动阶段确认的初版需求规格与技术方案；后续在迭代中新增的首页/项目页拆分、只读代码区、Supabase 持久化、Vercel Serverless 兼容以及多厂商原生 Provider 适配层等演进与取舍，详见 [DESIGN_SUMMARY.md](./DESIGN_SUMMARY.md)。

## 1. 产品目标与核心定位

构建一个可独立运行的 **Atoms Demo** 网页应用：用户通过自然语言提出应用需求，系统由 **单智能体 ReAct 循环** 驱动，自主完成「思考规划 → 读写多文件代码 → 静态编译校验 → 生成/迭代应用」全过程，并在右侧隔离沙箱中 **零延迟实时渲染** 可交互的现代 React + Tailwind 网页应用。

```mermaid
flowchart LR
    U["用户输入需求 / 多轮修改"] --> API["Next.js SSE API Route"]
    API --> LLM["真实 LLM API (OpenAI 兼容)"]
    LLM -->|"Thought + Tool Call"| TOOLS["ReAct 工具执行层"]
    TOOLS -->|"Observation (文件/校验结果)"| LLM
    TOOLS -->|"实时流式事件"| UI["前端工作台 (过程可视化 + 代码更新)"]
    UI --> COMP["浏览器内即时编译 (TSX + Tailwind)"]
    COMP --> IFRAME["隔离 iframe 实时预览"]
    IFRAME -.->|"捕获运行时报错 (postMessage)"| FIX["一键触发 ReAct 自动修复"]
    FIX -.-> U
```

---

## 2. 功能需求清单

### 2.1 模型与 API 配置（前端设置 + 服务端安全代理）
- **配置入口**：顶部导航栏提供「模型配置」按钮及状态指示灯（未配置 / 已就绪）；未配置 Key 时发起生成会自动引导打开配置弹窗。
- **配置项**（持久化在浏览器 `localStorage`，不落盘服务端）：
  - **厂商快捷预设**：OpenAI、Google Gemini（OpenAI 兼容端点）、DeepSeek、OpenRouter、自定义（Custom）。
  - **Base URL**：支持任意兼容 OpenAI Chat Completions 协议的地址。
  - **API Key**：密码掩码输入，支持一键显示/清空。
  - **Model Name**：支持下拉推荐模型或手动输入任意模型 ID。
  - **最大步数限制（Max Iterations）**：默认 `10` 步，防止异常死循环。
- **连通性测试**：弹窗内置「测试连接」按钮，快速验证 Key 与 Base URL 是否有效。
- **服务端代理**：所有 LLM 请求经由 Next.js API Route 转发，避免浏览器跨域（CORS）问题。

### 2.2 对话与项目管理工作台（左侧栏）
- **需求输入与快捷示例**：
  - 支持多行输入（`Enter` 发送、`Shift+Enter` 换行）与生成中「停止（Abort）」按钮。
  - 空白状态提供 4 个内置示例 Prompt（如*番茄钟效率看板*、*个人记账与图表仪表盘*、*互动 Kanban 任务板*、*复古街机小游戏*），点击即填充或运行。
- **多轮迭代**：在已有代码基础上继续对话修改，智能体自动读取现有文件并做增量编辑或新增组件。
- **项目与版本管理**：
  - 支持新建项目、切换/删除历史项目（持久化在 `localStorage`）。
  - 每次智能体成功完成一轮生成，自动保存一个**版本快照（Snapshot）**，支持随时回滚到任意历史版本。

### 2.3 单智能体 ReAct 驱动与过程可视化（核心引擎）
- **标准 ReAct 循环**：`Thought（思考） → Action（调用工具） → Observation（执行反馈）` 循环执行，直至校验通过并输出最终总结。
- **智能体内置工具集（6 个）**：
  1. `list_files`：查看当前虚拟项目的文件目录与行数。
  2. `read_file`：读取指定文件内容（用于多轮迭代时理解现有实现）。
  3. `write_file`：创建或完整覆写文件（如 `src/App.tsx`、`src/components/*.tsx`、`src/styles.css`）。
  4. `edit_file`：基于精确文本匹配的局部替换（提升迭代效率、减少 token 消耗）。
  5. `delete_file`：删除冗余文件。
  6. `validate_project`：对当前全部项目文件执行 **TSX/TS 语法编译与模块导入检查**，若存在语法错误、缺少入口 `src/App.tsx` 或无效相对路径引用，立即返回精准报错给智能体触发自我修正。
- **过程可视化 UI**：
  - 聊天流中内嵌可折叠的 **ReAct 步骤卡片**：展示迭代轮次、思考内容、工具名称与参数（如修改了哪个文件）、执行结果状态（运行中 / 成功 / 失败）与单步耗时。
  - 文件写入时同步触发右侧代码区更新，实时反馈进度。

### 2.4 代码工作区（右侧 Tab：Code）
- **多文件树**：清晰展示生成的目录结构（如 `src/App.tsx`、`src/components/...`、`src/styles.css`），标注当前新增/修改的文件。
- **代码查看与手动微调**：支持语法高亮展示与直接编辑代码；手动编辑后自动触发预览区即时重编译。
- **导出能力**：
  - 单文件一键复制。
  - 一键下载为可独立双击打开的 **单文件 HTML**（内嵌打包后逻辑）或 **项目 ZIP 源码包**。

### 2.5 实时可视化预览沙箱（右侧 Tab：Preview）
- **技术形态**：支持单/多文件 **React 18/19 + TypeScript (TSX) + Tailwind CSS**，预置常用生态库（`lucide-react` 图标库等），通过浏览器内编译 + ESM Import Map 注入隔离 `iframe` 实现零延迟渲染。
- **沙箱安全隔离**：`iframe` 启用 `sandbox="allow-scripts allow-forms allow-modals allow-popups"`（不开启 `allow-same-origin`），防止生成代码读取宿主页面的 API Key 或 `localStorage`。
- **预览工具栏**：
  - 视口切换：桌面端（100%）、平板（768px）、手机（375px）。
  - 快捷操作：重新渲染、全屏预览、新窗口预览。
- **运行时报错捕获与一键自修复**：
  - 预览环境自动注入 React `ErrorBoundary`、`window.onerror`、`unhandledrejection` 监听器，通过 `postMessage` 将错误堆栈上报至宿主页面。
  - 出现运行时错误时，预览底部弹出错误条并展示详情，提供 **「交给智能体自动修复」** 按钮，一键将报错信息作为新指令注入 ReAct 循环完成修复。

---

## 3. 技术架构与核心选型

| 层级 | 技术选型 | 说明 |
| :--- | :--- | :--- |
| **宿主框架** | Next.js (App Router) + TypeScript | 前后端一体，原生支持 SSE Streaming Route Handlers |
| **UI 与样式** | Tailwind CSS + `lucide-react` | 现代深/浅色 IDE 分栏风格，支持拖拽调整左右分栏比例 |
| **LLM 通信** | OpenAI 兼容 Chat Completions API (Streaming + Function Calling) | 一套代码兼容 OpenAI / Gemini / DeepSeek / OpenRouter 及自定义网关 |
| **流式传输** | Server-Sent Events (SSE) | 实时推送 `thought`、`tool_call`、`tool_result`、`file_update`、`done`、`error` 事件 |
| **编译与校验** | `sucrase`（TSX/TS 极速编译）+ 相对导入解析器 | 同时运行在服务端（供 `validate_project` 校验）和浏览器端（实现毫秒级热预览，零 WASM 启动延迟） |
| **沙箱渲染** | 隔离 `iframe` `srcdoc` + ESM `importmap` (`data:` 模块 + `esm.sh`) + Tailwind Play CDN | 支持多文件 ES Module 相互导入，无需 `allow-same-origin`，零构建等待 |
| **本地存储** | `localStorage` | 保存模型配置、多项目文件、对话历史与版本快照 |

### 3.1 初始规划目录结构

```text
atom-demo/
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                  # 主工作台入口（分栏 IDE 布局）
│   │   ├── globals.css
│   │   └── api/
│   │       ├── agent/run/route.ts    # ReAct 智能体主循环 (SSE 流式)
│   │       └── model/test/route.ts   # LLM API 连通性测试接口
│   ├── lib/
│   │   ├── types.ts                  # 项目、文件、ReAct 事件、配置类型定义
│   │   ├── compiler.ts               # 多文件 TSX/TS 编译、Import 解析与静态校验
│   │   ├── preview-builder.ts        # 生成隔离 iframe srcdoc（含 importmap 与错误捕获）
│   │   ├── agent-tools.ts            # 6 个 ReAct 工具定义与虚拟文件系统执行器
│   │   ├── system-prompt.ts          # 指导生成高质量现代 React+Tailwind 应用的 Prompt
│   │   ├── storage.ts                # localStorage 项目/快照/配置管理
│   │   └── export.ts                 # 导出独立 HTML / ZIP 源码包
│   └── components/
│       ├── TopBar.tsx                # 顶部栏（项目切换、版本回溯、模型设置、导出）
│       ├── ChatPanel.tsx             # 左侧对话区 + Prompt 模板 + 输入控制
│       ├── ReActStepCard.tsx         # ReAct 思考/工具调用/校验过程可视化卡片
│       ├── WorkspacePanel.tsx        # 右侧 Preview / Code 切换容器
│       ├── PreviewPane.tsx           # 隔离 iframe 预览 + 视口切换 + 错误自修复条
│       ├── CodePane.tsx              # 文件树 + 语法高亮可编辑代码视图
│       └── SettingsModal.tsx         # 模型与 API Key 配置弹窗
├── package.json
└── tsconfig.json
```

---

## 4. 验收标准（MVP 闭环）

1. **配置可用**：在前端设置面板填入任意 OpenAI 兼容 API Key（含 Gemini / DeepSeek / OpenAI 等）并测试通过。
2. **智能体可观测**：输入应用需求后，左侧实时流式展示智能体 ReAct 的思考、创建/编辑多文件、调用 `validate_project` 校验（出错时自动修复）的完整轨迹。
3. **预览可交互**：右侧自动渲染出美观、可交互的 React + Tailwind 应用，支持桌面/平板/手机视口切换；手动修改代码可即时刷新预览。
4. **多轮与自修复闭环**：支持继续提需求进行二次修改、回滚历史版本；若生成代码触发运行时报错，能捕获并一键交给智能体自动修复。
5. **可导出与运行验证**：支持导出独立 HTML / 源码包，且项目通过 TypeScript 类型检查、构建及端到端浏览器实测验证。

---

## 5. 实施里程碑

1. **阶段一：脚手架与核心编译沙箱** — 初始化 Next.js + Tailwind 项目，实现多文件 TSX 编译器（`compiler.ts`）、校验器与隔离 `iframe` 预览生成器（`preview-builder.ts`）。
2. **阶段二：ReAct 智能体后端引擎** — 实现 6 个虚拟文件系统工具、系统提示词、OpenAI 兼容流式 Function Calling ReAct 循环（SSE）与连通性测试接口。
3. **阶段三：IDE 工作台与可视化界面** — 实现分栏拖拽布局、模型设置弹窗、ReAct 步骤流可视化、Preview 沙箱（视口/报错捕获/一键修复）、Code 编辑器与导出功能。
4. **阶段四：联调与全面验证** — 运行构建与类型检查，在浏览器中端到端验证配置、预览渲染、手动编辑热更新、报错捕获与导出能力。
