-- Replaces the non-atomic, wrongly-scoped enforcement of "at most one
-- active check-in per user" added in 20260912183849. That index only
-- covered (user_id), not (user_id, kind), despite its own comment saying
-- it enforces one active *post-meal* check-in — and its own migration
-- comment (20260912170137) already documents that `kind` will grow a
-- second value for S-02 (fixed-daily-checkins). Re-scoping it here so it
-- matches what the schema already promises, even though this has no
-- observable effect until `kind` actually gains a second value (`kind` is
-- still CHECK-constrained to 'post_meal' only).
--
-- Also replaces deferCheckIn's insert-then-update (two independent
-- Supabase-JS calls, never atomic) with a single atomic statement wrapped
-- in a SECURITY INVOKER function, so the invariant can never be violated
-- even transiently — the previous insert-before-update ordering made this
-- fail deterministically on every sequential defer call, not just under
-- concurrency.
drop index if exists public.check_ins_one_active_per_user;

create unique index check_ins_one_active_per_user
  on public.check_ins (user_id, kind)
  where completed_at is null and superseded_by is null;

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
