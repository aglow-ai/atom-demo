-- Atoms Demo: Supabase Projects Schema
-- 在 Supabase Dashboard -> SQL Editor 中执行以下 SQL 完成建表

create table if not exists public.atoms_projects (
  id text primary key,
  name text not null default '未命名应用',
  description text not null default '',
  files jsonb not null default '{}'::jsonb,
  messages jsonb not null default '[]'::jsonb,
  snapshots jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_atoms_projects_updated_at
  on public.atoms_projects (updated_at desc);

-- 自动更新 updated_at 触发器
create or replace function public.set_atoms_projects_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_atoms_projects_updated_at on public.atoms_projects;
create trigger trg_atoms_projects_updated_at
  before update on public.atoms_projects
  for each row
  execute function public.set_atoms_projects_updated_at();

-- 行级安全策略（RLS）
-- 推荐后端配置 SUPABASE_SERVICE_ROLE_KEY（会自动绕过 RLS）。
-- 如果仅配置 Anon Key 用于本地 Demo，可启用下方策略允许读写：
alter table public.atoms_projects enable row level security;

drop policy if exists "Allow demo access to atoms_projects" on public.atoms_projects;
create policy "Allow demo access to atoms_projects"
  on public.atoms_projects
  for all
  using (true)
  with check (true);
