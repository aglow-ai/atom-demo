import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedServerContext } from "@/lib/supabase/server";
import {
  PROJECTS_TABLE,
  rowToProject,
  rowToProjectSummary,
  type SupabaseProjectRow,
} from "@/lib/supabase-server";
import type { ChatMessage, ProjectFiles, ProjectSnapshot } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await getAuthenticatedServerContext();
  if (!auth) {
    return NextResponse.json(
      { error: "请先使用 Google 账号登录" },
      { status: 401 }
    );
  }

  const { supabase, user } = auth;
  const { data, error } = await supabase
    .from(PROJECTS_TABLE)
    .select(
      "id, user_id, name, description, files, messages, snapshots, created_at, updated_at"
    )
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      {
        storage: "error",
        projects: [],
        error: error.message,
      },
      { status: 500 }
    );
  }

  const summaries = (data as SupabaseProjectRow[]).map(rowToProjectSummary);
  return NextResponse.json({
    storage: "supabase",
    projects: summaries,
  });
}

export async function POST(req: NextRequest) {
  const auth = await getAuthenticatedServerContext();
  if (!auth) {
    return NextResponse.json(
      { error: "请先使用 Google 账号登录" },
      { status: 401 }
    );
  }

  const { supabase, user } = auth;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      id?: string;
      name?: string;
      description?: string;
      files?: ProjectFiles;
      messages?: ChatMessage[];
      snapshots?: ProjectSnapshot[];
    };

    const nowIso = new Date().toISOString();
    const id =
      body.id?.trim() ||
      `proj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const payload = {
      id,
      user_id: user.id,
      name: body.name?.trim() || "未命名应用",
      description: body.description?.trim() || "",
      files: body.files || {},
      messages: body.messages || [],
      snapshots: body.snapshots || [],
      created_at: nowIso,
      updated_at: nowIso,
    };

    const { data, error } = await supabase
      .from(PROJECTS_TABLE)
      .insert(payload)
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: `创建项目失败: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        storage: "supabase",
        project: rowToProject(data as SupabaseProjectRow),
      },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "请求解析失败" },
      { status: 400 }
    );
  }
}
