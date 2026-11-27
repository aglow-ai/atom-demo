-- Atoms Demo: Supabase Projects Schema
-- 在 Supabase Dashboard -> SQL Editor 中执行以下 SQL 完成建表与用户隔离 RLS 配置

create table if not exists public.atoms_projects (
  id text primary key,
  user_id uuid references auth.users (id) on delete cascade,
  name text not null default '未命名应用',
  description text not null default '',
  files jsonb not null default '{}'::jsonb,
  messages jsonb not null default '[]'::jsonb,
  snapshots jsonb not null default '[]'::jsonb,
  agent_status text not null default 'idle',
  agent_job_id text,
  agent_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_atoms_projects_updated_at
  on public.atoms_projects (updated_at desc);

create index if not exists idx_atoms_projects_user_updated_at
  on public.atoms_projects (user_id, updated_at desc);

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

-- 行级安全策略（RLS）：每个登录用户仅可读写自己的项目
alter table public.atoms_projects enable row level security;

drop policy if exists "Allow demo access to atoms_projects" on public.atoms_projects;
drop policy if exists "Users can view own atoms_projects" on public.atoms_projects;
drop policy if exists "Users can insert own atoms_projects" on public.atoms_projects;
drop policy if exists "Users can update own atoms_projects" on public.atoms_projects;
drop policy if exists "Users can delete own atoms_projects" on public.atoms_projects;

create policy "Users can view own atoms_projects"
  on public.atoms_projects
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert own atoms_projects"
  on public.atoms_projects
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update own atoms_projects"
  on public.atoms_projects
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own atoms_projects"
  on public.atoms_projects
  for delete
  to authenticated
  using (auth.uid() = user_id);
