import type { Project, ProjectSummary, SupabaseStatusInfo } from "./types";

const PENDING_PROMPT_PREFIX = "atoms_pending_prompt_";
const PENDING_HOME_PROMPT_KEY = "atoms_pending_home_prompt_v1";

export function toProjectSummary(project: Project): ProjectSummary {
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

export async function fetchSupabaseStatus(): Promise<SupabaseStatusInfo> {
  try {
    const res = await fetch("/api/supabase/status", { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return (await res.json()) as SupabaseStatusInfo;
  } catch (err) {
    return {
      configured: false,
      connected: false,
      tableReady: false,
      storageMode: "supabase",
      error: err instanceof Error ? err.message : "状态检查失败",
    };
  }
}

export async function listProjects(): Promise<{
  projects: ProjectSummary[];
  unauthorized?: boolean;
  error?: string;
}> {
  try {
    const res = await fetch("/api/projects", { cache: "no-store" });
    if (res.status === 401) {
      return { projects: [], unauthorized: true };
    }
    const data = await res.json().catch(() => ({}));
    if (res.ok && Array.isArray(data.projects)) {
      return {
        projects: data.projects as ProjectSummary[],
      };
    }
    return {
      projects: [],
      error: data.error || `加载项目失败 (HTTP ${res.status})`,
    };
  } catch (err) {
    return {
      projects: [],
      error: err instanceof Error ? err.message : "网络异常，无法加载项目列表",
    };
  }
}

export async function createProject(params?: {
  name?: string;
  description?: string;
}): Promise<{
  project: Project | null;
  unauthorized?: boolean;
  error?: string;
}> {
  const name = params?.name?.trim() || "未命名应用";
  const description = params?.description?.trim() || "";

  try {
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description }),
    });
    if (res.status === 401) {
      return { project: null, unauthorized: true };
    }
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.project) {
      return { project: data.project as Project };
    }
    return {
      project: null,
      error: data.error || `创建项目失败 (HTTP ${res.status})`,
    };
  } catch (err) {
    return {
      project: null,
      error: err instanceof Error ? err.message : "网络异常，创建项目失败",
    };
  }
}

export async function getProjectById(id: string): Promise<{
  project: Project | null;
  unauthorized?: boolean;
  error?: string;
}> {
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
      cache: "no-store",
    });
    if (res.status === 401) {
      return { project: null, unauthorized: true };
    }
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.project) {
      return { project: data.project as Project };
    }
    return {
      project: null,
      error: data.error || `加载项目失败 (HTTP ${res.status})`,
    };
  } catch (err) {
    return {
      project: null,
      error: err instanceof Error ? err.message : "网络异常，加载项目失败",
    };
  }
}

export async function saveProject(project: Project): Promise<{
  ok: boolean;
  unauthorized?: boolean;
  error?: string;
}> {
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: project.name,
        description: project.description ?? "",
        files: project.files,
        messages: project.messages,
        snapshots: project.snapshots,
      }),
    });
    if (res.status === 401) {
      return { ok: false, unauthorized: true };
    }
    if (res.ok) {
      return { ok: true };
    }
    const data = await res.json().catch(() => ({}));
    return {
      ok: false,
      error: data.error || `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "网络异常",
    };
  }
}

export async function renameProjectById(
  id: string,
  name: string
): Promise<{ ok: boolean; unauthorized?: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.status === 401) {
      return { ok: false, unauthorized: true };
    }
    if (res.ok) {
      return { ok: true };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: false, error: data.error || `HTTP ${res.status}` };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "网络异常",
    };
  }
}

export async function deleteProjectById(id: string): Promise<{
  ok: boolean;
  unauthorized?: boolean;
  error?: string;
}> {
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (res.status === 401) {
      return { ok: false, unauthorized: true };
    }
    if (res.ok) {
      return { ok: true };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: false, error: data.error || `HTTP ${res.status}` };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "网络异常",
    };
  }
}

export function setPendingPrompt(projectId: string, prompt: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(`${PENDING_PROMPT_PREFIX}${projectId}`, prompt);
  } catch {
    // ignore
  }
}

export function consumePendingPrompt(projectId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const key = `${PENDING_PROMPT_PREFIX}${projectId}`;
    const value = window.sessionStorage.getItem(key);
    if (value) {
      window.sessionStorage.removeItem(key);
    }
    return value;
  } catch {
    return null;
  }
}

export function setPendingHomePrompt(prompt: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(PENDING_HOME_PROMPT_KEY, prompt);
  } catch {
    // ignore
  }
}

export function consumePendingHomePrompt(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.sessionStorage.getItem(PENDING_HOME_PROMPT_KEY);
    if (value) {
      window.sessionStorage.removeItem(PENDING_HOME_PROMPT_KEY);
    }
    return value;
  } catch {
    return null;
  }
}
