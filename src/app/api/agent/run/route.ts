import { after, NextRequest, NextResponse } from "next/server";
import { prepareBackgroundAgentJob } from "@/lib/agent-runner";
import { getAuthenticatedServerContext } from "@/lib/supabase/server";
import { PROJECTS_TABLE } from "@/lib/supabase-server";
import type { ModelConfig, Project } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

interface StartAgentRequest {
  project: Project;
  prompt: string;
  config: ModelConfig;
}

export async function POST(req: NextRequest) {
  const auth = await getAuthenticatedServerContext();
  if (!auth) {
    return NextResponse.json(
      { error: "请先使用 Google 账号登录" },
      { status: 401 }
    );
  }

  let body: StartAgentRequest;
  try {
    body = (await req.json()) as StartAgentRequest;
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }

  const prompt = body.prompt?.trim();
  const project = body.project;
  const config = body.config;

  if (!project?.id) {
    return NextResponse.json({ error: "缺少项目信息" }, { status: 400 });
  }

  if (!prompt) {
    return NextResponse.json({ error: "需求描述不能为空" }, { status: 400 });
  }

  if (
    !config?.apiKey?.trim() ||
    !config?.baseUrl?.trim() ||
    !config?.model?.trim()
  ) {
    return NextResponse.json(
      { error: "请先在右上角「模型设置」中配置有效的 API Key 与模型。" },
      { status: 400 }
    );
  }

  const { data: ownedProject, error: ownershipError } = await auth.supabase
    .from(PROJECTS_TABLE)
    .select("id")
    .eq("id", project.id)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (ownershipError) {
    return NextResponse.json(
      { error: `校验项目权限失败: ${ownershipError.message}` },
      { status: 500 }
    );
  }

  if (!ownedProject) {
    return NextResponse.json(
      { error: "项目不存在或无权访问" },
      { status: 404 }
    );
  }

  const backgroundSupabase = await auth.createBackgroundClient();

  const prepared = await prepareBackgroundAgentJob({
    supabase: auth.supabase,
    backgroundSupabase,
    userId: auth.user.id,
    project,
    prompt,
    config,
  });

  // Schedule execution inside Next.js after() so Vercel Serverless keeps the function alive via waitUntil()
  if (prepared.execute) {
    const runTask = prepared.execute;
    after(async () => {
      await runTask();
    });
  }

  return NextResponse.json({
    ok: true,
    jobId: prepared.jobId,
    alreadyRunning: prepared.alreadyRunning,
    project: prepared.project,
  });
}
