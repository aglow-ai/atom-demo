-- Migration: create public.atoms_projects table for Atoms Demo
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

alter table public.atoms_projects enable row level security;

drop policy if exists "Allow demo access to atoms_projects" on public.atoms_projects;
create policy "Allow demo access to atoms_projects"
  on public.atoms_projects
  for all
  using (true)
  with check (true);
