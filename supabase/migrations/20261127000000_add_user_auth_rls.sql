-- Migration: add user_id ownership and per-user RLS policies to atoms_projects

alter table public.atoms_projects
  add column if not exists user_id uuid references auth.users (id) on delete cascade;

create index if not exists idx_atoms_projects_user_updated_at
  on public.atoms_projects (user_id, updated_at desc);

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
