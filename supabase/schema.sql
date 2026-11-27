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


-- ============================================================================
-- User Credits & Token Usage Billing (新注册用户赠送 100 积分)
-- ============================================================================

create table if not exists public.user_credits (
  user_id uuid primary key references auth.users (id) on delete cascade,
  balance integer not null default 100 check (balance >= 0),
  total_granted integer not null default 100,
  total_spent integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  delta integer not null,
  balance_after integer not null,
  reason text not null,
  project_id text,
  job_id text,
  model text,
  input_tokens integer not null default 0,
  cached_input_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  output_tokens integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.credit_transactions
  add column if not exists cached_input_tokens integer not null default 0,
  add column if not exists cache_write_tokens integer not null default 0;

create index if not exists idx_credit_transactions_user_created_at
  on public.credit_transactions (user_id, created_at desc);

create unique index if not exists uq_credit_transactions_user_job_usage
  on public.credit_transactions (user_id, job_id)
  where reason = 'agent_usage' and job_id is not null;

create or replace function public.set_user_credits_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_user_credits_updated_at on public.user_credits;
create trigger trg_user_credits_updated_at
  before update on public.user_credits
  for each row
  execute function public.set_user_credits_updated_at();

alter table public.user_credits enable row level security;
alter table public.credit_transactions enable row level security;

drop policy if exists "Users can view own credits" on public.user_credits;
create policy "Users can view own credits"
  on public.user_credits
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can view own credit transactions" on public.credit_transactions;
create policy "Users can view own credit transactions"
  on public.credit_transactions
  for select
  to authenticated
  using (auth.uid() = user_id);

create or replace function public.handle_new_user_initial_credits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bonus constant integer := 100;
  v_inserted integer := 0;
begin
  insert into public.user_credits (user_id, balance, total_granted, total_spent)
  values (new.id, v_bonus, v_bonus, 0)
  on conflict (user_id) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted > 0 then
    insert into public.credit_transactions (
      user_id,
      delta,
      balance_after,
      reason,
      metadata
    )
    values (
      new.id,
      v_bonus,
      v_bonus,
      'signup_bonus',
      jsonb_build_object('note', '新用户注册赠送 100 积分')
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_auth_users_initial_credits on auth.users;
create trigger trg_auth_users_initial_credits
  after insert on auth.users
  for each row
  execute function public.handle_new_user_initial_credits();

create or replace function public.ensure_user_credits(p_user_id uuid default null)
returns table (
  user_id uuid,
  balance integer,
  total_granted integer,
  total_spent integer
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_caller_uid uuid := auth.uid();
  v_jwt_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
  v_target_uid uuid;
  v_bonus constant integer := 100;
  v_inserted integer := 0;
begin
  if v_caller_uid is not null then
    if p_user_id is not null and p_user_id <> v_caller_uid then
      raise exception 'Forbidden';
    end if;
    v_target_uid := v_caller_uid;
  elsif v_jwt_role = 'service_role' and p_user_id is not null then
    v_target_uid := p_user_id;
  else
    raise exception 'Unauthorized';
  end if;

  insert into public.user_credits (user_id, balance, total_granted, total_spent)
  values (v_target_uid, v_bonus, v_bonus, 0)
  on conflict on constraint user_credits_pkey do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted > 0 then
    insert into public.credit_transactions (
      user_id,
      delta,
      balance_after,
      reason,
      metadata
    )
    values (
      v_target_uid,
      v_bonus,
      v_bonus,
      'signup_bonus',
      jsonb_build_object('note', '新用户注册赠送 100 积分')
    );
  end if;

  return query
  select uc.user_id, uc.balance, uc.total_granted, uc.total_spent
  from public.user_credits uc
  where uc.user_id = v_target_uid;
end;
$$;

drop function if exists public.deduct_user_credits(uuid, integer, text, text, text, integer, integer);
create or replace function public.deduct_user_credits(
  p_user_id uuid,
  p_amount integer,
  p_project_id text default null,
  p_job_id text default null,
  p_model text default null,
  p_input_tokens integer default 0,
  p_output_tokens integer default 0,
  p_cached_input_tokens integer default 0,
  p_cache_write_tokens integer default 0
)
returns table (
  charged integer,
  balance integer,
  total_spent integer,
  already_charged boolean
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_caller_uid uuid := auth.uid();
  v_jwt_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
  v_target_uid uuid;
  v_current_balance integer;
  v_current_spent integer;
  v_actual_charge integer;
  v_new_balance integer;
  v_new_spent integer;
  v_existing_delta integer;
begin
  if v_caller_uid is not null then
    if p_user_id is not null and p_user_id <> v_caller_uid then
      raise exception 'Forbidden';
    end if;
    v_target_uid := v_caller_uid;
  elsif v_jwt_role = 'service_role' and p_user_id is not null then
    v_target_uid := p_user_id;
  else
    raise exception 'Unauthorized';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Deduction amount must be positive';
  end if;

  perform public.ensure_user_credits(v_target_uid);

  select uc.balance, uc.total_spent
    into v_current_balance, v_current_spent
  from public.user_credits uc
  where uc.user_id = v_target_uid
  for update;

  if p_job_id is not null then
    select ct.delta
      into v_existing_delta
    from public.credit_transactions ct
    where ct.user_id = v_target_uid
      and ct.job_id = p_job_id
      and ct.reason = 'agent_usage'
    limit 1;

    if found then
      return query
      select abs(v_existing_delta), v_current_balance, v_current_spent, true;
      return;
    end if;
  end if;

  v_actual_charge := least(v_current_balance, p_amount);
  v_new_balance := v_current_balance - v_actual_charge;
  v_new_spent := v_current_spent + v_actual_charge;

  update public.user_credits uc
  set balance = v_new_balance,
      total_spent = v_new_spent
  where uc.user_id = v_target_uid;

  insert into public.credit_transactions (
    user_id,
    delta,
    balance_after,
    reason,
    project_id,
    job_id,
    model,
    input_tokens,
    cached_input_tokens,
    cache_write_tokens,
    output_tokens,
    metadata
  )
  values (
    v_target_uid,
    -v_actual_charge,
    v_new_balance,
    'agent_usage',
    p_project_id,
    p_job_id,
    p_model,
    greatest(coalesce(p_input_tokens, 0), 0),
    greatest(coalesce(p_cached_input_tokens, 0), 0),
    greatest(coalesce(p_cache_write_tokens, 0), 0),
    greatest(coalesce(p_output_tokens, 0), 0),
    jsonb_build_object('requested_amount', p_amount)
  );

  return query
  select v_actual_charge, v_new_balance, v_new_spent, false;
end;
$$;

grant execute on function public.ensure_user_credits(uuid) to authenticated, service_role;
grant execute on function public.deduct_user_credits(uuid, integer, text, text, text, integer, integer, integer, integer) to authenticated, service_role;
