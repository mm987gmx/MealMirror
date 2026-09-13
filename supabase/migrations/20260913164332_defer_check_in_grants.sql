-- Postgres grants EXECUTE on new functions to PUBLIC by default. Without
-- this, defer_check_in() would be callable by the unauthenticated `anon`
-- role via PostgREST's /rpc/defer_check_in endpoint. Not currently
-- exploitable (an anon caller's auth.uid() is null, so it can never match
-- a real check_ins row), but this project's own convention (see
-- 20260912173705_meal_checkin_table_grants.sql) is to never rely on RLS
-- alone for authenticated-only access — health data must never be
-- reachable without authentication (NFR).
revoke execute on function public.defer_check_in(uuid, uuid, uuid) from public;
grant execute on function public.defer_check_in(uuid, uuid, uuid) to authenticated;
