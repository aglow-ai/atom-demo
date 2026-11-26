import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  ChatMessage,
  Project,
  ProjectFiles,
  ProjectSnapshot,
  ProjectSummary,
} from "./types";

export const PROJECTS_TABLE = "atoms_projects";

export interface SupabaseProjectRow {
  id: string;
  name: string;
  description: string | null;
  files: ProjectFiles | null;
  messages: ChatMessage[] | null;
  snapshots: ProjectSnapshot[] | null;
  agent_status?: string | null;
  agent_job_id?: string | null;
  agent_updated_at?: string | null;
  created_at: string;
  updated_at: string;
}

function getSupabaseEnv() {
  const url = (
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    ""
  ).trim();
  const key = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    ""
  ).trim();

  return { url, key };
}

export function isSupabaseConfigured(): boolean {
  const { url, key } = getSupabaseEnv();
  return Boolean(url && key);
}

export function getSupabaseUrlHost(): string | undefined {
  const { url } = getSupabaseEnv();
  if (!url) return undefined;
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

let cachedClient: SupabaseClient | null = null;
let cachedEnvSignature = "";

export function getSupabaseServerClient(): SupabaseClient | null {
  const { url, key } = getSupabaseEnv();
  if (!url || !key) return null;

  const sig = `${url}|${key.slice(0, 12)}`;
  if (!cachedClient || cachedEnvSignature !== sig) {
    cachedClient = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    cachedEnvSignature = sig;
  }
  return cachedClient;
}

export function rowToProject(row: SupabaseProjectRow): Project {
  return {
    id: row.id,
    name: row.name || "未命名应用",
    description: row.description || "",
    files: row.files && typeof row.files === "object" ? row.files : {},
    messages: Array.isArray(row.messages) ? row.messages : [],
    snapshots: Array.isArray(row.snapshots) ? row.snapshots : [],
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
  };
}

export function rowToProjectSummary(row: SupabaseProjectRow): ProjectSummary {
  const files = row.files && typeof row.files === "object" ? row.files : {};
  const messages = Array.isArray(row.messages) ? row.messages : [];
  const snapshots = Array.isArray(row.snapshots) ? row.snapshots : [];
  const fileNames = Object.keys(files).sort();

  const firstUserMsg = messages.find((m) => m.role === "user")?.content || "";
  const description = (row.description || firstUserMsg || "").trim().slice(0, 140);

  return {
    id: row.id,
    name: row.name || "未命名应用",
    description,
    fileCount: fileNames.length,
    snapshotCount: snapshots.length,
    messageCount: messages.length,
    fileNames: fileNames.slice(0, 5),
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
  };
}

export function projectToSummary(project: Project): ProjectSummary {
  const fileNames = Object.keys(project.files || {}).sort();
  const firstUserMsg =
    (project.messages || []).find((m) => m.role === "user")?.content || "";
  const description = (project.description || firstUserMsg || "")
    .trim()
    .slice(0, 140);

  return {
    id: project.id,
    name: project.name || "未命名应用",
    description,
    fileCount: fileNames.length,
    snapshotCount: (project.snapshots || []).length,
    messageCount: (project.messages || []).length,
    fileNames: fileNames.slice(0, 5),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}
