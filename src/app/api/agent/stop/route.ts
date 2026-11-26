import { NextRequest, NextResponse } from "next/server";
import { stopAgentJob } from "@/lib/agent-runner";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { projectId?: string };
    const projectId = body.projectId?.trim() || "";
    if (!projectId) {
      return NextResponse.json(
        { ok: false, error: "缺少 projectId" },
        { status: 400 }
      );
    }

    const stopped = stopAgentJob(projectId);
    return NextResponse.json({ ok: true, stopped });
  } catch {
    return NextResponse.json(
      { ok: false, error: "无效请求" },
      { status: 400 }
    );
  }
}
