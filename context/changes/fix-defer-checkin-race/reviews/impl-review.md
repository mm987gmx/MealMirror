<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Fix deferCheckIn Race Implementation Plan

- **Plan**: context/changes/fix-defer-checkin-race/plan.md
- **Scope**: Phase 1-2 of 2 (full plan)
- **Date**: 2026-09-13
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — `defer_check_in` has no EXECUTE grant restriction

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260913161106_defer_check_in_atomic.sql (whole file — the omission)
- **Detail**: Postgres grants `EXECUTE` on newly created functions to `PUBLIC` by default, and this migration has no `revoke`/`grant` statement for `defer_check_in`. The earlier `20260912173705_meal_checkin_table_grants.sql` explicitly excludes `anon` from table access because "health data must never be readable without authentication (NFR)" — this function has no equivalent statement, so it's very likely callable by the unauthenticated `anon` role via PostgREST's `/rpc/defer_check_in` endpoint today. Not currently exploitable (an anon caller has `auth.uid() IS NULL`, which can't satisfy `user_id = p_user_id` for any real row, so it only ever produces the generic `defer_conflict` error) — but it leaves this RPC with zero independent access-control layer beyond RLS, deviating from this project's own stated "never trust RLS alone" convention.
- **Fix**: Add `revoke execute on function public.defer_check_in(uuid,uuid,uuid) from public; grant execute on function public.defer_check_in(uuid,uuid,uuid) to authenticated;` in a follow-up migration.
- **Decision**: FIXED — added `supabase/migrations/20260913164332_defer_check_in_grants.sql`; applied locally; full test suite (6 files, 16 tests) still passes, confirming `authenticated` access is preserved.

### F2 — Asymmetric defense-in-depth: `meal_id` ownership not explicitly checked

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260913161106_defer_check_in_atomic.sql:41-49
- **Detail**: The function applies an explicit, RLS-redundant ownership predicate for `user_id` (`and user_id = p_user_id`) but has no equivalent explicit check for `meal_id` ownership before the INSERT — that dimension relies solely on the `check_ins_insert_own` RLS policy's `exists(...)` clause. `resolveCollision`'s defer path passes `input.mealId` straight from client form data, validated only for UUID shape (`src/lib/validation/meal-tracking.ts:20`), never checked against the caller's own meals in application code. Not exploitable today (RLS covers it), but it's inconsistent with the belt-and-suspenders pattern the same function applies one line above for `user_id`, and a single future RLS misconfiguration would silently reintroduce the exact meal-ownership gap that migration `20260912170136` was written to close.
- **Fix A ⭐ Recommended**: Add an explicit `exists(select 1 from public.meals m where m.id = p_meal_id and m.user_id = p_user_id)` guard in the function, mirroring the `user_id` treatment.
  - Strength: Matches this project's own established defense-in-depth convention exactly; closes the gap even if RLS is ever misconfigured.
  - Tradeoff: A few more lines in the function; one more thing to keep in sync if the RLS policy shape ever changes.
  - Confidence: HIGH — this is literally the same pattern already used one predicate above in the same function.
  - Blind spot: None significant.
- **Fix B**: Leave as-is, accept RLS-only protection for this one dimension.
  - Strength: Zero additional code.
  - Tradeoff: Leaves one asymmetric gap in an otherwise consistently defense-in-depth function, in a health-data app.
  - Confidence: MEDIUM — depends on how strictly the project wants to apply its own stated convention.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — added `supabase/migrations/20260913164443_defer_check_in_meal_ownership.sql` (explicit `exists(...)` guard raising `invalid_meal` before any write); applied locally; full test suite still passes (6 files, 16 tests).

### F3 — `check-ins.test.ts` doesn't reuse a shared test-setup helper

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/check-ins.test.ts:23, 57, 85 (per-block `createAdminClient()` + inline try/finally)
- **Detail**: The sibling `meals.test.ts` in the same directory factors admin-client creation and per-test user setup/teardown into one shared `withTestUser` helper with a single module-level `createAdminClient()` call. `check-ins.test.ts` instead calls `createAdminClient()` fresh inside each of its three `describe` blocks and duplicates the same try/finally boilerplate inline three times. Not a bug — `createAdminClient()` is cheap and stateless — but it's real duplication against the pattern the sibling file had just established.
- **Fix**: Extract a shared `withTestUser` helper (or import the one from `meals.test.ts` if it gets promoted to `src/lib/test-support/`) and use it across all three describe blocks.
- **Decision**: FIXED — added a local `withTestUser` helper matching `meals.test.ts`'s pattern (without modifying that sibling-owned file); all three describe blocks refactored to use it. Full suite still passes (6 files, 16 tests).

### F4 — Hardcoded `interval '90 minutes'` duplicates `POST_MEAL_CHECK_IN_DUE_MINUTES`

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: supabase/migrations/20260913161106_defer_check_in_atomic.sql:47 vs. src/lib/services/check-ins.ts:5 (`POST_MEAL_CHECK_IN_DUE_MINUTES = 90`)
- **Detail**: The RPC hardcodes the 90-minute due-time offset directly in SQL, duplicating the constant `scheduleCheckIn` uses. A future change to one without the other would silently desync `scheduleCheckIn`'s and `defer_check_in`'s due-time behavior.
- **Fix**: Note the duplication in a comment at both sites pointing to each other (cheapest option, since there's no clean single source of truth across TS and SQL without a config table), or accept as a known, documented duplication.
- **Decision**: FIXED — added `supabase/migrations/20260913165335_defer_check_in_due_at_note.sql` (comment-only, no behavior change) and a mirroring comment on `POST_MEAL_CHECK_IN_DUE_MINUTES` in `src/lib/services/check-ins.ts:5`. Full suite, typecheck, lint, and build all still pass.

## Notes (no action needed)

- **SECURITY INVOKER + RLS reasoning — confirmed correct.** Traced both the UPDATE and INSERT paths: the explicit `user_id = p_user_id` predicate plus `check_ins_update_own`/`check_ins_insert_own` RLS policies together force `p_user_id = auth.uid()` for any row to be touched. A cross-user call matches zero rows either way. No cross-user data disclosure in the exception message.
- **Race condition — confirmed safe.** Under READ COMMITTED, the UPDATE's row lock forces a second concurrent caller to block, then re-evaluate its WHERE predicate via EvalPlanQual once the first transaction commits — the loser's UPDATE (and thus its dependent INSERT) matches zero rows, correctly triggering `defer_conflict`. This is genuine database-level serialization, not an application-level check-then-act race, and is exactly what the 3x-repeated concurrency test verifies.
- **SQL injection, error propagation, test reliability** — all confirmed clean (parameterized queries throughout; the raw Postgrest error object with `code`/`message` intact propagates unmodified from the RPC through `deferCheckIn` to `collision.ts`'s catch block; `Promise.allSettled` correctly awaited with proper try/finally cleanup in tests).
