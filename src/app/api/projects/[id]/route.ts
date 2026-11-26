import { NextRequest, NextResponse } from "next/server";
import {
  getSupabaseServerClient,
  PROJECTS_TABLE,
  rowToProject,
  type SupabaseProjectRow,
} from "@/lib/supabase-server";
import type { ChatMessage, ProjectFiles, ProjectSnapshot } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      { storage: "unconfigured", error: "Supabase 尚未配置" },
      { status: 503 }
    );
  }

  const { id } = await context.params;
  const { data, error } = await supabase
    .from(PROJECTS_TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  return NextResponse.json({
    storage: "supabase",
    project: rowToProject(data as SupabaseProjectRow),
  });
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      { storage: "unconfigured", error: "Supabase 尚未配置" },
      { status: 503 }
    );
  }

  const { id } = await context.params;

  try {
    const body = (await req.json()) as {
      name?: string;
      description?: string;
      files?: ProjectFiles;
      messages?: ChatMessage[];
      snapshots?: ProjectSnapshot[];
    };

    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (typeof body.name === "string") updatePayload.name = body.name;
    if (typeof body.description === "string") {
      updatePayload.description = body.description;
    }
    if (body.files && typeof body.files === "object") {
      updatePayload.files = body.files;
    }
    if (Array.isArray(body.messages)) {
      updatePayload.messages = body.messages;
    }
    if (Array.isArray(body.snapshots)) {
      updatePayload.snapshots = body.snapshots;
    }

    const isFullSync =
      body.files !== undefined &&
      Array.isArray(body.messages) &&
      Array.isArray(body.snapshots);

    const { data, error } = isFullSync
      ? await supabase
          .from(PROJECTS_TABLE)
          .upsert(
            {
              id,
              name: typeof body.name === "string" ? body.name : "未命名应用",
              description:
                typeof body.description === "string" ? body.description : "",
              files: body.files,
              messages: body.messages,
              snapshots: body.snapshots,
              updated_at: updatePayload.updated_at,
            },
            { onConflict: "id" }
          )
          .select()
          .single()
      : await supabase
          .from(PROJECTS_TABLE)
          .update(updatePayload)
          .eq("id", id)
          .select()
          .single();

    if (error) {
      return NextResponse.json(
        { error: `保存项目失败: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      storage: "supabase",
      project: rowToProject(data as SupabaseProjectRow),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "更新请求无效" },
      { status: 400 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      { storage: "unconfigured", error: "Supabase 尚未配置" },
      { status: 503 }
    );
  }

  const { id } = await context.params;
  const { error } = await supabase
    .from(PROJECTS_TABLE)
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json(
      { error: `删除项目失败: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, id });
}
