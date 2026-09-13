-- Comment-only change: flags the duplicated 90-minute due-time offset
-- against src/lib/services/check-ins.ts's POST_MEAL_CHECK_IN_DUE_MINUTES
-- constant, so a future change to one doesn't silently desync from the
-- other. No behavior change.
create or replace function public.defer_check_in(
  p_user_id uuid,
  p_active_check_in_id uuid,
  p_meal_id uuid
)
returns public.check_ins
language plpgsql
security invoker
as $$
declare
  v_result public.check_ins;
begin
  if not exists (
    select 1 from public.meals m where m.id = p_meal_id and m.user_id = p_user_id
  ) then
    raise exception 'invalid_meal: meal % does not belong to user %', p_meal_id, p_user_id
      using errcode = 'P0001';
  end if;

  with new_id as (
    select gen_random_uuid() as id
  ), superseded as (
    update public.check_ins
    set superseded_by = (select id from new_id)
    where id = p_active_check_in_id
      and user_id = p_user_id
      and completed_at is null
      and superseded_by is null
    returning superseded_by
  )
  insert into public.check_ins (id, user_id, meal_id, kind, due_at)
  -- 90 minutes duplicates POST_MEAL_CHECK_IN_DUE_MINUTES in
  -- src/lib/services/check-ins.ts — keep both in sync if this ever changes.
  select superseded.superseded_by, p_user_id, p_meal_id, 'post_meal', now() + interval '90 minutes'
  from superseded
  returning * into v_result;

  if not found then
    raise exception 'defer_conflict: check-in % is no longer the active check-in for user %',
      p_active_check_in_id, p_user_id
      using errcode = 'P0001';
  end if;

  return v_result;
end;
$$;
