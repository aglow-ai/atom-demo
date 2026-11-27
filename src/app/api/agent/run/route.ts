import { after, NextRequest, NextResponse } from "next/server";
import { prepareBackgroundAgentJob } from "@/lib/agent-runner";
import { ensureUserCredits } from "@/lib/credits";
import { getAuthenticatedServerContext } from "@/lib/supabase/server";
import { PROJECTS_TABLE } from "@/lib/supabase-server";
import { getSystemModelServerConfig } from "@/lib/system-model";
import {
  getResolvedModelMode,
  type ModelConfig,
  type ModelConfigMode,
  type Project,
} from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

interface StartAgentRequest {
  project: Project;
  prompt: string;
  config?: ModelConfig;
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
  const rawConfig = body.config;

  if (!project?.id) {
    return NextResponse.json({ error: "缺少项目信息" }, { status: 400 });
  }

  if (!prompt) {
    return NextResponse.json({ error: "需求描述不能为空" }, { status: 400 });
  }

  const requestedMode: ModelConfigMode = rawConfig
    ? getResolvedModelMode(rawConfig)
    : "system";

  let effectiveConfig: ModelConfig;
  let billingMode: ModelConfigMode;

  if (requestedMode === "custom") {
    if (
      !rawConfig?.apiKey?.trim() ||
      !rawConfig?.baseUrl?.trim() ||
      !rawConfig?.model?.trim()
    ) {
      return NextResponse.json(
        { error: "请先在右上角「模型设置」中填写完整的自定义 API Key 与模型信息。" },
        { status: 400 }
      );
    }
    effectiveConfig = {
      ...rawConfig,
      mode: "custom",
      apiKey: rawConfig.apiKey.trim(),
      baseUrl: rawConfig.baseUrl.trim(),
      model: rawConfig.model.trim(),
    };
    billingMode = "custom";
  } else {
    const { config: systemConfig, publicInfo } = getSystemModelServerConfig();
    if (!systemConfig) {
      return NextResponse.json(
        {
          error:
            "系统默认模型尚未配置，请点击右上角「模型设置」切换并填写你自己的 API Key。",
          code: "SYSTEM_MODEL_UNAVAILABLE",
        },
        { status: 400 }
      );
    }

    const credits = await ensureUserCredits(auth.supabase, auth.user.id);
    if (!credits) {
      return NextResponse.json(
        {
          error:
            "积分账户初始化失败，请确认已在 Supabase 执行最新的积分迁移脚本。",
        },
        { status: 500 }
      );
    }

    if (credits.balance < publicInfo.minCreditsPerRun) {
      return NextResponse.json(
        {
          error: `积分不足（当前剩余 ${credits.balance} 积分），请在右上角「模型设置」中切换为自定义 API Key 继续使用。`,
          code: "INSUFFICIENT_CREDITS",
          balance: credits.balance,
        },
        { status: 402 }
      );
    }

    const requestedMaxIter = Number(rawConfig?.maxIterations);
    effectiveConfig = {
      ...systemConfig,
      maxIterations: Number.isFinite(requestedMaxIter)
        ? Math.min(Math.max(Math.floor(requestedMaxIter), 4), 20)
        : systemConfig.maxIterations,
    };
    billingMode = "system";
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
    billingMode,
    project,
    prompt,
    config: effectiveConfig,
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
    billingMode,
    project: prepared.project,
  });
}
