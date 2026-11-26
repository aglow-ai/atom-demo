import {
  createEmptyProject,
  loadProjects as loadLocalProjects,
  saveProjects as saveLocalProjects,
} from "./storage";
import type { Project, ProjectSummary, SupabaseStatusInfo } from "./types";

const PENDING_PROMPT_PREFIX = "atoms_pending_prompt_";

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
      storageMode: "local",
      error: err instanceof Error ? err.message : "状态检查失败",
    };
  }
}

export async function listProjects(): Promise<{
  storageMode: "supabase" | "local";
  projects: ProjectSummary[];
  error?: string;
}> {
  try {
    const res = await fetch("/api/projects", { cache: "no-store" });
    const data = await res.json();
    if (res.ok && data.storage === "supabase") {
      return {
        storageMode: "supabase",
        projects: data.projects as ProjectSummary[],
      };
    }
    // Fallback to localStorage when Supabase is unconfigured or table not yet created
    const local = loadLocalProjects()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(toProjectSummary);
    return {
      storageMode: "local",
      projects: local,
      error: data.storage === "error" ? data.error : undefined,
    };
  } catch {
    const local = loadLocalProjects()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(toProjectSummary);
    return { storageMode: "local", projects: local };
  }
}

export async function createProject(params?: {
  name?: string;
  description?: string;
}): Promise<{ project: Project; storageMode: "supabase" | "local" }> {
  const name = params?.name?.trim() || "未命名应用";
  const description = params?.description?.trim() || "";

  try {
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.project) {
        return { project: data.project as Project, storageMode: "supabase" };
      }
    }
  } catch {
    // fallback to local
  }

  const localProj = createEmptyProject(name);
  localProj.description = description;
  const all = loadLocalProjects();
  saveLocalProjects([localProj, ...all]);
  return { project: localProj, storageMode: "local" };
}

export async function getProjectById(id: string): Promise<{
  project: Project | null;
  storageMode: "supabase" | "local";
}> {
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
      cache: "no-store",
    });
    if (res.ok) {
      const data = await res.json();
      if (data.project) {
        return { project: data.project as Project, storageMode: "supabase" };
      }
    }
    if (res.status === 404) {
      // Check local storage just in case it was created before configuring Supabase
      const localMatch = loadLocalProjects().find((p) => p.id === id) ?? null;
      return {
        project: localMatch,
        storageMode: localMatch ? "local" : "supabase",
      };
    }
  } catch {
    // fallback to local
  }

  const localMatch = loadLocalProjects().find((p) => p.id === id) ?? null;
  return { project: localMatch, storageMode: "local" };
}

export async function saveProject(project: Project): Promise<{
  storageMode: "supabase" | "local";
  ok: boolean;
  error?: string;
}> {
  // Always keep a local mirror in case user reloads offline
  const allLocal = loadLocalProjects();
  const existsLocal = allLocal.some((p) => p.id === project.id);
  const nextLocal = existsLocal
    ? allLocal.map((p) => (p.id === project.id ? project : p))
    : [project, ...allLocal];
  saveLocalProjects(nextLocal);

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
    if (res.ok) {
      return { storageMode: "supabase", ok: true };
    }
    if (res.status === 503) {
      return { storageMode: "local", ok: true };
    }
    const data = await res.json().catch(() => ({}));
    return {
      storageMode: "local",
      ok: false,
      error: data.error || `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      storageMode: "local",
      ok: false,
      error: err instanceof Error ? err.message : "网络异常",
    };
  }
}

export async function renameProjectById(
  id: string,
  name: string
): Promise<{ storageMode: "supabase" | "local"; ok: boolean }> {
  const allLocal = loadLocalProjects();
  saveLocalProjects(
    allLocal.map((p) =>
      p.id === id ? { ...p, name, updatedAt: Date.now() } : p
    )
  );

  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      return { storageMode: "supabase", ok: true };
    }
  } catch {
    // ignore
  }
  return { storageMode: "local", ok: true };
}

export async function deleteProjectById(id: string): Promise<{
  storageMode: "supabase" | "local";
  ok: boolean;
}> {
  const remainingLocal = loadLocalProjects().filter((p) => p.id !== id);
  saveLocalProjects(remainingLocal);

  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (res.ok) {
      return { storageMode: "supabase", ok: true };
    }
  } catch {
    // ignore
  }
  return { storageMode: "local", ok: true };
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
