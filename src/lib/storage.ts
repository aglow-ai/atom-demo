import {
  DEFAULT_MODEL_CONFIG,
  type ModelConfig,
  type Project,
} from "./types";

const CONFIG_KEY = "atoms_demo_model_config_v1";
const PROJECTS_KEY = "atoms_demo_projects_v1";
const ACTIVE_PROJECT_KEY = "atoms_demo_active_project_v1";
const THEME_KEY = "atoms_demo_theme_v1";

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function loadModelConfig(): ModelConfig {
  if (!isBrowser()) return { ...DEFAULT_MODEL_CONFIG };
  try {
    const raw = window.localStorage.getItem(CONFIG_KEY);
    if (!raw) return { ...DEFAULT_MODEL_CONFIG };
    const parsed = JSON.parse(raw) as Partial<ModelConfig>;
    const merged: ModelConfig = {
      ...DEFAULT_MODEL_CONFIG,
      ...parsed,
    };
    if (parsed.mode !== "system" && parsed.mode !== "custom") {
      merged.mode = merged.apiKey.trim() ? "custom" : "system";
    }
    return merged;
  } catch {
    return { ...DEFAULT_MODEL_CONFIG };
  }
}

export function saveModelConfig(config: ModelConfig): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch {
    // ignore storage quota errors
  }
}

export function createEmptyProject(name = "未命名应用"): Project {
  const now = Date.now();
  return {
    id: `proj_${now}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    files: {},
    messages: [],
    snapshots: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function loadProjects(): Project[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(PROJECTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as Project[];
  } catch {
    return [];
  }
}

export function saveProjects(projects: Project[]): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
  } catch {
    // ignore storage quota errors
  }
}

export function loadActiveProjectId(): string | null {
  if (!isBrowser()) return null;
  try {
    return window.localStorage.getItem(ACTIVE_PROJECT_KEY);
  } catch {
    return null;
  }
}

export function saveActiveProjectId(id: string): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(ACTIVE_PROJECT_KEY, id);
  } catch {
    // ignore
  }
}

export function loadTheme(): "dark" | "light" {
  if (!isBrowser()) return "dark";
  try {
    const t = window.localStorage.getItem(THEME_KEY);
    return t === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function saveTheme(theme: "dark" | "light"): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // ignore
  }
}
