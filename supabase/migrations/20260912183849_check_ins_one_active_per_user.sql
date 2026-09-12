-- Enforces "at most one active post-meal check-in per user" at the data
-- layer. Without this, two concurrent defer/create requests could each
-- pass the application-level check-then-act check and both end up
-- "active" (completed_at is null and superseded_by is null),
-- breaking the invariant the whole feature depends on.
create unique index check_ins_one_active_per_user
  on public.check_ins (user_id)
  where completed_at is null and superseded_by is null;
