# Frame Brief: deferCheckIn / single-active-check-in invariant

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

Every sequential, non-concurrent call to `deferCheckIn` fails deterministically
with `duplicate key value violates unique constraint
"check_ins_one_active_per_user"` — reproduced by two failing tests in
`src/lib/services/meals.test.ts` (uncommitted, in
`context/changes/testing-collision-invariant-coverage`).

## Initial Framing (preserved)

- **User's stated cause or approach**: `deferCheckIn` inserts the new active
  check-in before updating the old one's `superseded_by`, so both rows are
  transiently "active" at once, violating the partial unique index added by
  commit `20cc899` to close a *concurrent*-request race.
- **User's proposed direction**: make the constraint deferrable and wrap the
  insert+update in a transaction (possibly a Postgres RPC), or restructure
  the write order — explicitly left undecided.
- **Pre-dispatch narrowing**: user was not sure whether this is purely the
  ordering bug or also a scoping question tied to the planned `kind` column
  growth (S-02) — asked to investigate and report back.

## Dimension Map

1. **Write ordering/atomicity in `deferCheckIn`** — insert-then-update
   creates a transient double-active state, which the index rejects, every
   single call, deterministically.  ← initial framing
2. **Invariant grain (index scope)** — the index covers `(user_id)` alone,
   not `(user_id, kind)`, conflicting with the schema's own documented plan
   for a second `kind` value.
3. **Other write paths with the same insert-while-active shape** —
   `createMealWithCheckIn`'s own insert.
4. **Codebase convention for atomic multi-statement writes** — whether any
   existing pattern (RPC, transaction) exists to build the fix on.

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| H1: `deferCheckIn`'s insert-then-update ordering deterministically violates the index | Two failing tests reproduce it every run. `src/lib/services/check-ins.ts:40-54`: `scheduleCheckIn` (insert, lines 46/31-35) runs while the row named by `activeCheckInId` is still active — that's the precondition for even calling `deferCheckIn` (`src/lib/services/meals.ts:41`). Independently confirmed by a blind sub-agent, which also found a naive statement-reorder doesn't work: the UPDATE needs `newCheckIn.id`, which doesn't exist until after the INSERT (`gen_random_uuid()` default, `supabase/migrations/20260912170135_meal_checkin_schema.sql:10`) | STRONG |
| H2: the index's grain (`user_id` only) conflicts with the schema's own documented multi-kind plan | `supabase/migrations/20260912183849_check_ins_one_active_per_user.sql`'s own comment says it enforces "one active **post-meal** check-in," but its `WHERE` clause has no `kind` filter. `supabase/migrations/20260912170137_check_ins_meal_id_comment.sql:1-5` explicitly reserves `kind` for S-02's morning/evening check-ins. Independently confirmed by the blind sub-agent from the same two files | STRONG |
| H3: `createMealWithCheckIn` has the same deterministic defect | Ruled out as a *new* issue — its insert only runs in the no-collision branch (`src/lib/services/meals.ts:26-31`), never while an active check-in exists. It's susceptible only under genuine concurrency, which is exactly the race the index was added to catch (test-plan Risk #2) — already-anticipated behavior, not a new defect | NONE (as new issue) |
| H4: no existing atomic-write pattern in this codebase | Grepped `src/` and `supabase/` for `.rpc(`, `CREATE FUNCTION`, transaction usage — no matches anywhere. Every write path uses independent, sequential Supabase-JS `.from()` calls. Also: the constraint is a bare `CREATE UNIQUE INDEX`, not a table constraint — Postgres can't defer a plain unique index to commit regardless of transaction wrapping | STRONG (scoping fact, not a separate cause) |

## Narrowing Signals

- User asked to investigate rather than assume whether this is one problem or two (Step 1.5) — the investigation found two independent, evidence-backed defects sharing one index, not competing explanations for one symptom.
- User confirmed (final question) both defects belong in this change's scope, since they share the same index and fixing only the ordering would leave S-02 to rediscover the grain problem later.
- User chose to trust the archived impl-review's claim that the *concurrent* scenario was already verified — consistent with H3 being ruled out as a new issue, not something this investigation needed to re-litigate.

## Cross-System Convention

No convention exists yet in this codebase for atomic multi-statement writes — no RPC, no stored procedure, no explicit transaction wrapping anywhere in `src/` or `supabase/`. Every other write path trusts RLS plus a single-statement constraint. Whatever fix addresses H1 (some form of atomic write — a single SQL statement, a Postgres function/RPC, or a client-generated-UUID restructuring) will be a first for this project, not an extension of an existing pattern. This is a real constraint on the solution space `/10x-plan` should design against explicitly, not discover mid-implementation.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: the `check_ins_one_active_per_user` invariant, as currently implemented, is both wrongly enforced (its write ordering makes every `deferCheckIn` call fail today, not just under concurrency) and wrongly scoped (indexed on `user_id` alone, when the schema's own migrations already document a near-future second `kind` value that must not compete with post-meal check-ins for the same "active" slot).

Both defects trace back to the single index added in commit `20cc899` to close a genuine concurrency race, added without re-verifying the ordinary sequential defer path or accounting for `kind`'s already-documented future growth. A plan that only reorders `deferCheckIn`'s two statements would leave the grain problem for S-02 (`fixed-daily-checkins`) to rediscover the hard way, against the same index, later. Fixing both now — against the same index, in the same change — is cheaper than two separate fixes at two separate times.

## Confidence

**HIGH** — strong evidence from two independent investigations (direct reads plus a blind sub-agent that converged on the same two dimensions from the same file:line evidence), a clear convention analysis (no atomic-write pattern exists, so the plan must introduce one deliberately), and a decisive user-confirmed scope signal.

## What Changes for /10x-plan

The plan should redesign the `check_ins_one_active_per_user` index's grain (`(user_id, kind)` instead of `(user_id)`, via a new migration) **and** make `deferCheckIn`'s write atomic and correctly ordered against that redesigned invariant — very likely via a Postgres function/RPC or a single atomic SQL statement, since no transactional pattern exists yet to build on in this codebase. It should not be scoped as a one-line statement reorder; that approach doesn't even work (see H1's UUID chicken-and-egg finding) and wouldn't touch H2 at all. The misleading "already resolved elsewhere, please refresh" error message on the defer path (`src/pages/api/check-ins/collision.ts:32-33`) should also be revisited once the underlying failure is no longer a routine, deterministic occurrence.

## References

- `src/lib/services/check-ins.ts:40-54` — `deferCheckIn`
- `src/lib/services/meals.ts:14-44` — `createMealWithCheckIn`, `resolveCollision`
- `supabase/migrations/20260912183849_check_ins_one_active_per_user.sql` — the index at the center of both defects
- `supabase/migrations/20260912170137_check_ins_meal_id_comment.sql` — documents the planned `kind` growth (S-02)
- `src/lib/services/meals.test.ts` — reproduction (uncommitted, in `context/changes/testing-collision-invariant-coverage`)
- `context/archive/2026-09-12-post-meal-checkin-loop/reviews/impl-review.md` — original finding F1 that led to the index
- `context/foundation/roadmap.md` — S-02 `fixed-daily-checkins` (proposed)
- Investigation: one blind background sub-agent, independently confirmed both hypotheses
