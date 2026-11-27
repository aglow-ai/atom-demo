-- Migration: fix PL/pgSQL OUT parameter vs column name ambiguity in ensure_user_credits and deduct_user_credits

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
