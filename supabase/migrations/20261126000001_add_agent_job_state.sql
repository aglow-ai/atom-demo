-- Migration: add serverless background agent job state columns to atoms_projects
alter table public.atoms_projects
  add column if not exists agent_status text not null default 'idle',
  add column if not exists agent_job_id text,
  add column if not exists agent_updated_at timestamptz;
