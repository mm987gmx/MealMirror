-- F-01's migration ran as the `postgres` role, whose default ACL for the
-- public schema does not include base CRUD (arwd) privileges for
-- anon/authenticated/service_role — only tables created by supabase_admin
-- get those automatically. Without this GRANT, every query is rejected
-- with "permission denied" before RLS policies are ever evaluated.
-- `anon` is intentionally left out: health data must never be readable
-- without authentication (NFR).
grant select, insert, update, delete on public.meals to authenticated, service_role;
grant select, insert, update, delete on public.check_ins to authenticated, service_role;
