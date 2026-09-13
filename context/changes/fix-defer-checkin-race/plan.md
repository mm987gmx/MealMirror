# Fix deferCheckIn Race Implementation Plan

## Overview

Replace the `check_ins_one_active_per_user` invariant's current enforcement — which is both non-atomic (breaks every sequential `deferCheckIn` call) and wrongly scoped (indexed on `user_id` alone, not `user_id`+`kind`) — with a correctly-scoped index plus an atomic Postgres RPC function, and wire `deferCheckIn` to use it.

## Current State Analysis

`deferCheckIn` (`src/lib/services/check-ins.ts:40-54`) inserts the new active check-in *before* updating the old one's `superseded_by`. Since the old row is still active at that moment (that's the precondition for calling `deferCheckIn` at all — `src/lib/services/meals.ts:41`), the insert always collides with the partial unique index `check_ins_one_active_per_user` (`supabase/migrations/20260912183849_check_ins_one_active_per_user.sql`), added by an earlier fix (commit `20cc899`) to close a *concurrent*-request race. The result: every sequential (non-concurrent) defer call fails deterministically — confirmed by two failing tests in the sibling change's `src/lib/services/meals.test.ts` (uncommitted, `context/changes/testing-collision-invariant-coverage`).

The same index is also scoped too broadly: its own migration comment says it enforces "one active **post-meal** check-in," but the index has no `kind` filter, while `supabase/migrations/20260912170137_check_ins_meal_id_comment.sql` documents that `kind` will grow a second value for roadmap slice S-02 (`fixed-daily-checkins`). Both defects were confirmed independently (direct code reading plus a blind sub-agent investigation) in `context/changes/fix-defer-checkin-race/frame.md`, which this plan treats as authoritative for the problem framing.

No RPC/stored-procedure pattern exists anywhere in this codebase yet (`src/database.types.ts`'s `Functions: Record<never, never>` confirms it) — this is the first one. Local Postgres is version 17 (`supabase/config.toml:36`), well past the PG15 minimum for `SECURITY INVOKER` functions. Both `check_ins` and `meals` are empty in local dev — no data-migration risk.

## Desired End State

A sequential `deferCheckIn` call succeeds normally, producing the same DB state it always intended to (old check-in superseded, new one active, correctly linked). Two concurrent `deferCheckIn` calls against the same active check-in still can't both win — exactly one succeeds, the other receives a distinct, deliberate error (`isDeferConflict`), and exactly one active check-in exists afterward. The index's grain now matches what the schema's own migrations already document for S-02, even though that has no observable effect until a second `kind` value exists.

### Key Discoveries:

- `src/lib/services/check-ins.ts:29-38` (`scheduleCheckIn`) is the only `INSERT INTO check_ins` in the codebase — the RPC replaces exactly this call path within `deferCheckIn`, nothing else.
- `createMealWithCheckIn` (`src/lib/services/meals.ts:14-33`) has no deterministic version of this bug — its insert only runs in the no-collision branch, never while an active check-in exists — confirmed in `frame.md`'s H3 (ruled out as a new issue). Left unchanged per this session's Q6.
- The constraint is a bare `CREATE UNIQUE INDEX`, not a deferrable table constraint — Postgres can't defer a plain index to commit regardless of transaction wrapping (`frame.md` H4). Atomicity must come from a single statement/function, not from wrapping two client calls in a transaction.
- No existing type-generation npm script; `src/database.types.ts` was hand-generated via the Supabase CLI. Regenerating it (`npx supabase gen types typescript --local`) is a required manual step after the migration, not something `npm run build`/`typecheck` does automatically.

## What We're NOT Doing

- Not touching the `check_ins.kind` CHECK constraint (still locked to `'post_meal'`) — adding real multi-kind support is roadmap slice S-02's job, not this fix's.
- Not routing `createMealWithCheckIn`'s insert through an RPC — it has no deterministic bug; its one real risk (genuine concurrent double-create) is already correctly handled by the existing check-then-act + unique-index + friendly-error pattern.
- Not rewording the "already resolved elsewhere, please refresh" user-facing message — it was already the right words for the real race case; only the mechanism underneath was wrong.
- Not committing or modifying the sibling `testing-collision-invariant-coverage` change's `src/lib/services/meals.test.ts` — that file stays owned by that change's Phase 3, resumed separately once this fix lands. This plan's own tests verify the fix independently, at the `deferCheckIn` level.
- Not adding a route-level (API handler) test for `collision.ts`'s updated catch block — the sibling change's own Phase 4 already designs exactly that test; this plan verifies the `isDeferConflict` helper and the RPC's behavior at the service layer, which is what Phase 4 will build on.
- Not wiring CI for the new migration/tests — CI/CD YAML changes are reserved to a different part of this project's workflow per `CLAUDE.md`.

## Implementation Approach

Fix the schema layer first (index grain + RPC function), verify it directly via `.rpc()` before anything depends on it, then wire the service layer to use it and add the regression tests that prove both the sequential fix and the preserved concurrency-safety.

## Critical Implementation Details

**Strict ordering: migrate → regenerate types → implement.** The migration must be applied locally (`npx supabase migration up`) before `src/database.types.ts` is regenerated, and types must be regenerated before the service-layer code that calls `supabase.rpc("defer_check_in", ...)` is written — otherwise the call is untyped/unchecked and `npm run typecheck` won't catch a parameter-shape mistake.

**The index-grain fix is unobservable behaviorally today.** `check_ins.kind` is CHECK-constrained to always `'post_meal'`, so `(user_id)` and `(user_id, kind)` partition into identical groups until a second `kind` value exists (S-02). Phase 1's verification for this half of the fix is necessarily schema-level (inspecting the index definition), not a runtime test — there is no way to write a passing/failing behavioral test for it yet, and that's expected, not a gap.

## Phase 1: Schema — Atomic Defer Invariant

### Overview

Replace the index and add the RPC function that performs the defer swap atomically; verify the function directly before any application code depends on it.

### Changes Required:

#### 1. New migration

**File**: `supabase/migrations/<timestamp>_defer_check_in_atomic.sql` (new; timestamp per this project's `YYYYMMDDHHmmss` convention, later than `20260912183849`)

**Intent**: Fix both defects against the same index in one migration: correct its grain to `(user_id, kind)`, and add an atomic function so the insert+update swap can never leave two rows simultaneously active, under concurrency or otherwise.

**Contract**: Drops and recreates `check_ins_one_active_per_user` scoped to `(user_id, kind)` (same predicate, same name). Adds `public.defer_check_in(p_user_id uuid, p_active_check_in_id uuid, p_meal_id uuid) returns public.check_ins`, `language plpgsql`, `security invoker`. The function generates the new row's id once, uses it in both the UPDATE and the chained INSERT via a single `WITH` CTE (so a losing concurrent caller's UPDATE matches zero rows and its INSERT becomes a no-op instead of violating the index), and raises a distinct, greppable exception when the swap doesn't apply:

```sql
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
```

#### 2. Regenerate generated types

**File**: `src/database.types.ts`

**Intent**: Make `defer_check_in` callable through `SupabaseClient<Database>.rpc(...)` with full type safety.

**Contract**: Run `npx supabase gen types typescript --local > src/database.types.ts` after the migration is applied. The `Functions` section should list `defer_check_in` with its argument and return-row types instead of `Record<never, never>`.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase migration up`
- Regenerated types include the function: `grep defer_check_in src/database.types.ts`
- A minimal direct-RPC test calls `supabase.rpc("defer_check_in", ...)` against a manually-seeded active check-in and succeeds, returning a row whose `id` matches the old row's new `superseded_by`
- `npm run typecheck` passes

#### Manual Verification:

- Inspect the new index in Supabase Studio (or `\d check_ins` via psql) and confirm it covers `(user_id, kind)`, not `user_id` alone

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Application Layer — Wire deferCheckIn to the RPC

### Overview

Swap `deferCheckIn`'s implementation to call the new RPC, update the one call site that inspected the old failure mode, and add regression tests proving both the sequential fix and the preserved concurrency-safety.

### Changes Required:

#### 1. New error-detection helper

**File**: `src/lib/services/postgres-errors.ts`

**Intent**: Let callers distinguish the RPC's deliberate "already resolved" conflict from other errors, matching the existing `isUniqueViolation` helper's style.

**Contract**: Exports `isDeferConflict(err: unknown): boolean`, checking for Postgres error code `P0001` with a message containing `"defer_conflict"`.

#### 2. Rewrite `deferCheckIn`

**File**: `src/lib/services/check-ins.ts`

**Intent**: Replace the two-step insert-then-update with a single call to the atomic RPC.

**Contract**: `deferCheckIn`'s signature and return type (`Promise<CheckIn>`) stay the same; its body becomes:

```ts
export async function deferCheckIn(supabase: Client, userId: string, activeCheckInId: string, mealId: string): Promise<CheckIn> {
  const { data, error } = await supabase.rpc("defer_check_in", {
    p_user_id: userId,
    p_active_check_in_id: activeCheckInId,
    p_meal_id: mealId,
  });
  if (error) throw error;
  return data;
}
```

`scheduleCheckIn` is unchanged — it's still used directly by `createMealWithCheckIn`'s no-collision branch.

#### 3. Update the one call site checking the old failure mode

**File**: `src/pages/api/check-ins/collision.ts`

**Intent**: The 23505 unique-violation this route used to catch for the defer path can no longer occur (the RPC never lets the raw insert collide) — replace that check with the new, deliberate `isDeferConflict`, keeping the exact same user-facing message.

**Contract**: Swap the `isUniqueViolation(err)` check in the catch block for `isDeferConflict(err)`; the ternary's message string is unchanged.

#### 4. Regression tests

**File**: `src/lib/services/check-ins.test.ts` (new)

**Intent**: Prove the sequential fix and prove concurrency-safety is preserved, using the already-committed test harness (`createAdminClient`/`createTestUser`/`signInTestUser` from `src/lib/test-support/supabase-test-client.ts`).

**Contract**: Two cases, each against a fresh throwaway user:
- Sequential: log a meal, log a second meal (collision), call `deferCheckIn` once — succeeds, returns the new check-in, and the old row's `superseded_by` points at it (previously this threw `23505` every time).
- Concurrent: with an active check-in in place, fire two `deferCheckIn` calls at the same `activeCheckInId` via `Promise.all` — exactly one resolves, the other rejects with an error where `isDeferConflict(err)` is `true`; afterward exactly one active check-in exists for that user. Repeat the concurrent case 3 times in the same test run to guard against a single lucky pass.

### Success Criteria:

#### Automated Verification:

- Both cases in `src/lib/services/check-ins.test.ts` pass, including the 3x-repeated concurrency case
- `npm run typecheck`, `npm run lint`, and `npm run build` all pass
- Running the sibling change's existing (uncommitted) `src/lib/services/meals.test.ts` now passes in full — confirms this fix actually unblocks it, without this change taking ownership of that file

#### Manual Verification:

- Spot-check the sequential case's resulting rows in Supabase Studio (old row superseded, new row active, correct `meal_id` on each)
- Spot-check the concurrent case's resulting rows similarly (exactly one active row, no orphaned duplicate)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `isDeferConflict` — covered inline as part of the concurrency regression test's assertions (no dedicated unit test needed given its trivial shape, matching `isUniqueViolation`'s own lack of a dedicated unit test before this plan; `isUniqueViolation`'s unit test already exists via the sibling change and needs no change here).

### Integration Tests:

- `src/lib/services/check-ins.test.ts`: sequential defer (previously broken, now fixed) and concurrent defer (must still yield exactly one winner).
- Both run against real local Postgres via the already-committed test harness — no mocking.

### Manual Testing Steps:

1. Inspect the new index's columns in Supabase Studio after Phase 1.
2. Spot-check sequential-defer DB state in Supabase Studio after Phase 2.
3. Spot-check concurrent-defer DB state in Supabase Studio after Phase 2.

## Performance Considerations

The RPC does one extra round trip compared to two separate calls it replaces only in the sense that it's now *one* round trip instead of two — a net improvement, not a cost. No load/performance testing scope beyond that (matches this project's stated low-qps target).

## Migration Notes

Both `meals` and `check_ins` are empty in local dev (verified directly) — no existing rows to reconcile against the corrected index. No rollback procedure beyond a follow-up migration if ever needed; nothing in this change is destructive to existing data.

## References

- Frame brief: `context/changes/fix-defer-checkin-race/frame.md`
- `src/lib/services/check-ins.ts:40-54` — `deferCheckIn` (being replaced)
- `src/lib/services/meals.ts:14-44` — `createMealWithCheckIn`, `resolveCollision` (unchanged, for context)
- `supabase/migrations/20260912183849_check_ins_one_active_per_user.sql` — the index this migration replaces
- `src/lib/services/postgres-errors.ts` — existing `isUniqueViolation`, style to match for `isDeferConflict`
- `src/lib/test-support/supabase-test-client.ts` — test harness reused from `context/changes/testing-collision-invariant-coverage`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema — Atomic Defer Invariant

#### Automated

- [x] 1.1 Migration applies cleanly — 3479eb9
- [x] 1.2 Regenerated types include `defer_check_in` — 3479eb9
- [x] 1.3 Minimal direct-RPC test passes — 3479eb9
- [x] 1.4 `npm run typecheck` passes — 3479eb9

#### Manual

- [x] 1.5 Index covers `(user_id, kind)`, confirmed in Supabase Studio — 3479eb9

### Phase 2: Application Layer — Wire deferCheckIn to the RPC

#### Automated

- [x] 2.1 Sequential-defer regression test passes
- [x] 2.2 Concurrent-defer regression test passes (3x repeated)
- [x] 2.3 `npm run typecheck`, `npm run lint`, `npm run build` all pass
- [x] 2.4 Sibling change's `meals.test.ts` passes in full

#### Manual

- [x] 2.5 Sequential-defer DB state spot-checked in Supabase Studio
- [x] 2.6 Concurrent-defer DB state spot-checked in Supabase Studio
