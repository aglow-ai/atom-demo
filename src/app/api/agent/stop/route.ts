import { NextRequest, NextResponse } from "next/server";
import { requestStopAgentJob } from "@/lib/agent-runner";
import { getAuthenticatedServerContext } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await getAuthenticatedServerContext();
  if (!auth) {
    return NextResponse.json(
      { ok: false, error: "请先使用 Google 账号登录" },
      { status: 401 }
    );
  }

  try {
    const body = (await req.json()) as { projectId?: string };
    const projectId = body.projectId?.trim() || "";
    if (!projectId) {
      return NextResponse.json(
        { ok: false, error: "缺少 projectId" },
        { status: 400 }
      );
    }

    const stopped = await requestStopAgentJob(
      auth.supabase,
      auth.user.id,
      projectId
    );
    return NextResponse.json({ ok: true, stopped });
  } catch {
    return NextResponse.json(
      { ok: false, error: "无效请求" },
      { status: 400 }
    );
  }
}
