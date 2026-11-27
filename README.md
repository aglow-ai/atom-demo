# Atoms Demo

智能体驱动的网页应用生成与实时可视化预览工作台（基于 Next.js App Router + TypeScript + Tailwind CSS + Supabase）。

## 核心特性

- **清晰的三页路由架构（`/` + `/projects` + `/project/[id]`）**：首页 `/` 专注一句话发起应用构建与示例模板；`/projects` 为独立的「我的项目」管理页（搜索、新建、删除）；`/project/[id]` 为分栏智能体工作台。
- **Supabase Auth (Google 登录) 与用户数据隔离**：基于 `@supabase/ssr` 实现标准 PKCE Google OAuth 登录与会话续期；未登录用户可浏览首页，创建或访问项目时引导 Google 登录，并通过 `atoms_projects.user_id` 与 PostgreSQL RLS 策略实现个人项目严格隔离。
- **后台 Supabase 数据库持久化**：所有项目元数据、生成的多文件代码、对话记录、ReAct 轨迹与版本快照通过 Next.js 后端 API 持久化至 Supabase `atoms_projects` 表。
- **单智能体 ReAct 循环**：通过多模型原生接口（OpenAI / Gemini / Anthropic / DeepSeek / OpenRouter）与 SSE 流式输出，自主完成「思考 → 读/写/编辑多文件 → 静态编译校验 → 自修复」闭环，并在左侧聊天流中实时可视化每一步执行轨迹。
- **浏览器内多文件 React + Tailwind 即时编译与隔离预览**：支持多文件 TSX/TS/CSS 相互导入与常用生态库（`lucide-react`、`recharts`、`framer-motion` 等），在受限 `iframe` 沙箱中零延迟渲染，支持桌面/平板/手机视口切换、只读语法高亮代码查阅、运行时报错一键自动修复及独立 HTML / Vite ZIP 导出。

## 配置 Supabase 数据库与 Google 登录

### 1. 配置环境变量

复制 `.env.example` 为 `.env.local` 并填入你的 Supabase 项目地址与密钥：

```bash
cp .env.example .env.local
```

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your-key
# 可选
# SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### 2. 推送数据库迁移（含 `user_id` 与 RLS 策略）

使用 Supabase CLI 推送迁移脚本（或直接在 Supabase SQL Editor 执行 [schema.sql](./supabase/schema.sql)）：

```bash
npx supabase login
npm run db:link
npm run db:push
```

### 3. 开启 Supabase Google 登录

1. **Google Cloud Console**：进入 *APIs & Services → Credentials* 创建 **OAuth 2.0 Client ID**（类型选择 *Web application*），在 *Authorized redirect URIs* 中添加：
   ```text
   https://<your-project-ref>.supabase.co/auth/v1/callback
   ```
2. **Supabase Dashboard → Authentication → Sign In / Providers → Google**：启用 Google Provider，填入上一步获得的 **Client ID** 与 **Client Secret**。
3. **Supabase Dashboard → Authentication → URL Configuration**：
   - 将 **Site URL** 设置为你的站点地址（本地开发为 `http://localhost:3000`）；
   - 在 **Redirect URLs** 中添加回调白名单：
     ```text
     http://localhost:3000/auth/callback
     https://<your-production-domain>/auth/callback
     ```

## 本地运行

```bash
npm install
npm run dev
```

访问 `http://localhost:3000`：
- 未登录时可自由浏览首页并输入或试用示例模板；
- 点击右上角 **「Google 登录」** 或发起构建/访问 `/projects` 时，将引导使用 Google 账号登录并进入你的专属云端工作台；
- 点击 **「模型设置」** 填入你的大模型 API Key 后即可开始生成网页应用。
