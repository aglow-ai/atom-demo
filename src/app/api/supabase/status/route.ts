import { NextResponse } from "next/server";
import {
  getSupabaseServerClient,
  getSupabaseUrlHost,
  isSupabaseConfigured,
  PROJECTS_TABLE,
} from "@/lib/supabase-server";
import type { SupabaseStatusInfo } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isSupabaseConfigured()) {
    const status: SupabaseStatusInfo = {
      configured: false,
      connected: false,
      tableReady: false,
      storageMode: "local",
    };
    return NextResponse.json(status);
  }

  const supabase = getSupabaseServerClient()!;
  const urlHost = getSupabaseUrlHost();

  try {
    const { error } = await supabase
      .from(PROJECTS_TABLE)
      .select("id")
      .limit(1);

    if (error) {
      const missingTable =
        error.code === "42P01" ||
        error.code === "PGRST205" ||
        error.message.includes("does not exist") ||
        error.message.includes("Could not find the table");

      const status: SupabaseStatusInfo = {
        configured: true,
        connected: missingTable,
        tableReady: false,
        storageMode: "local",
        urlHost,
        error: missingTable
          ? `已连接到 Supabase，但尚未创建 ${PROJECTS_TABLE} 表，请在 Supabase SQL Editor 中执行 supabase/schema.sql。`
          : error.message,
      };
      return NextResponse.json(status);
    }

    const status: SupabaseStatusInfo = {
      configured: true,
      connected: true,
      tableReady: true,
      storageMode: "supabase",
      urlHost,
    };
    return NextResponse.json(status);
  } catch (err) {
    const status: SupabaseStatusInfo = {
      configured: true,
      connected: false,
      tableReady: false,
      storageMode: "local",
      urlHost,
      error: err instanceof Error ? err.message : "Supabase 连接检查失败",
    };
    return NextResponse.json(status);
  }
}
