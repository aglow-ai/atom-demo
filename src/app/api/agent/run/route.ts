import { after, NextRequest, NextResponse } from "next/server";
import { prepareBackgroundAgentJob } from "@/lib/agent-runner";
import type { ModelConfig, Project } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

interface StartAgentRequest {
  project: Project;
  prompt: string;
  config: ModelConfig;
}

export async function POST(req: NextRequest) {
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

  const prepared = await prepareBackgroundAgentJob({
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
