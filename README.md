# Atoms Demo

智能体驱动的网页应用生成与实时可视化预览工作台（基于 Next.js App Router + TypeScript + Tailwind CSS + Supabase）。

## 核心特性

- **清晰的三页路由架构（`/` + `/projects` + `/project/[id]`）**：首页 `/` 专注一句话发起应用构建与示例模板；`/projects` 为独立的「我的项目」管理页（搜索、新建、删除）；`/project/[id]` 为分栏智能体工作台。
- **后台 Supabase 数据库持久化**：所有项目元数据、生成的多文件代码、对话记录、ReAct 轨迹与版本快照通过 Next.js 后端 API 持久化至 Supabase `atoms_projects` 表（未配置环境变量时自动降级为浏览器本地存储，随时无缝切换）。
- **单智能体 ReAct 循环**：通过 OpenAI 兼容 Function Calling 与 SSE 流式输出，自主完成「思考 → 读/写/编辑多文件 → 静态编译校验 → 自修复」闭环，并在左侧聊天流中实时可视化每一步执行轨迹。
- **前端自由配置真实 LLM API**：内置 OpenAI、Google Gemini、DeepSeek、OpenRouter 与自定义 OpenAI 兼容端点预设，支持一键连通性测试；API Key 仅保存在浏览器 `localStorage`，经由本地 Next.js API Route 代理转发。
- **浏览器内多文件 React + Tailwind 即时编译与隔离预览**：支持多文件 TSX/TS/CSS 相互导入与常用生态库（`lucide-react`、`recharts`、`framer-motion` 等），在受限 `iframe` 沙箱中零延迟渲染，支持桌面/平板/手机视口切换、只读语法高亮代码查阅、运行时报错一键自动修复及独立 HTML / Vite ZIP 导出。

## 配置 Supabase 数据库

1. 复制 `.env.example` 为 `.env.local` 并填入你的 Supabase 项目地址与密钥：

```bash
cp .env.example .env.local
```

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

2. 使用 Supabase CLI 一键推送迁移脚本（或直接在 Supabase SQL Editor 执行 [schema.sql](./supabase/schema.sql)）：

```bash
npx supabase login
npm run db:link
npm run db:push
```

## 本地运行

```bash
npm install
npm run dev
```

访问 `http://localhost:3000`：
- 点击右上角 **「配置 Supabase」** 可实时检测数据库连接与建表状态；
- 点击 **「配置 API Key」** 填入你的大模型接口后，即可在首页直接描述需求构建并保存你的网页应用。
