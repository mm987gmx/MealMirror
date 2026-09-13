# Fix deferCheckIn Race — Plan Brief

> Full plan: `context/changes/fix-defer-checkin-race/plan.md`
> Frame brief: `context/changes/fix-defer-checkin-race/frame.md`

## What & Why

The `check_ins_one_active_per_user` invariant, as currently implemented, is both wrongly enforced (its write ordering makes every `deferCheckIn` call fail today, not just under concurrency) and wrongly scoped (indexed on `user_id` alone, when the schema's own migrations already document a near-future second `kind` value that must not compete with post-meal check-ins for the same "active" slot). Both trace back to one index; this plan fixes both against that same index in one change.

## Starting Point

`deferCheckIn` inserts the new active check-in before updating the old one's `superseded_by`, so both rows are transiently active at once — a deterministic collision with the partial unique index added by an earlier fix (commit `20cc899`) to close a *concurrent*-request race. Every sequential defer call fails today. No RPC/transaction pattern exists anywhere in this codebase yet.

## Desired End State

A sequential defer succeeds normally. Two concurrent defers against the same check-in still can't both win — exactly one succeeds, the other gets a clear, deliberate error. The index's grain now matches what the schema already promises for the next check-in kind, even though nothing observable changes until that kind actually exists.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Problem scope | Fix both the ordering bug and the index grain in one change | They share one index; fixing only the ordering would leave the grain problem for S-02 to rediscover later | Frame |
| Atomicity mechanism | Single atomic `WITH` CTE statement | The insert only fires when the update actually matched, so a losing concurrent caller's insert becomes a no-op rather than violating the index | Plan (user-confirmed) |
| RPC security model | `SECURITY INVOKER` | Matches this project's defense-in-depth convention — RLS keeps applying inside the function; available on this project's Postgres 17 | Plan (user-confirmed) |
| Conflict signal | Raise a distinct, named Postgres exception | Keeps the existing catch/translate pattern (`isUniqueViolation`-style), just pointed at a deliberate signal instead of an incidental one | Plan (user-confirmed) |
| Index form | Plain unique index, not a named constraint | Smallest diff, matches the existing migration's own style; no `ON CONFLICT` usage that would benefit from a named constraint | Plan (user-confirmed) |
| Error copy | Unchanged | The existing "already resolved elsewhere" wording was already right for the real race case — only the trigger was buggy | Plan (user-confirmed) |
| `createMealWithCheckIn` | Left as a plain insert | It has no deterministic bug — its only risk is the genuine concurrency race the index already correctly handles | Plan (user-confirmed) |
| Test scope | Sequential-fix proof + concurrency-safety proof, both | Proves the fix without reintroducing the exact race the invariant existed to prevent | Plan (user-confirmed) |

## Scope

**In scope:**
- New migration: re-scope the index to `(user_id, kind)`, add the `defer_check_in()` RPC function
- Regenerate `src/database.types.ts`
- Rewrite `deferCheckIn` to call the RPC; add `isDeferConflict` helper; update `collision.ts`'s catch block
- New regression tests at the service layer (sequential + concurrency)

**Out of scope:**
- Loosening the `check_ins.kind` CHECK constraint (S-02's job)
- Routing `createMealWithCheckIn` through an RPC
- Rewording user-facing error copy
- Touching or committing the sibling change's `meals.test.ts`
- Route-level (API handler) tests for `collision.ts` — the sibling change's Phase 4 already owns that

## Architecture / Approach

Two auth-free, transaction-free client calls (insert, then update) become one atomic Postgres function call. The function generates the new row's id once, uses it in a CTE chaining an `UPDATE ... RETURNING` into a conditional `INSERT ... SELECT`, so the swap either fully happens or fully doesn't — no window where two rows are simultaneously active, and no window where a concurrent caller can slip through. `SECURITY INVOKER` keeps RLS enforcement exactly where it already is.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema: atomic invariant | New migration (index + RPC function), regenerated types, a direct-RPC smoke test | The index-grain half of the fix is unobservable behaviorally today — verified via schema inspection, not a runtime test, by design |
| 2. Application layer | `deferCheckIn` rewritten, `isDeferConflict`, `collision.ts` updated, full regression suite | A single passing concurrency test isn't enough evidence — mitigated with a 3x-repeated run |

**Prerequisites:** Local Supabase running (Docker); the sibling `testing-collision-invariant-coverage` change's Phase 1–2 test harness already committed (it is).
**Estimated effort:** ~1-2 sessions across 2 phases.

## Open Risks & Assumptions

- Assumes `SECURITY INVOKER` functions behave as expected on this project's Postgres 17 — confirmed available (PG15+ feature), not yet exercised in this codebase.
- The sibling change's `meals.test.ts` passing is used as a verification signal for this fix, but that file remains owned and eventually committed by the sibling change, not this one.

## Success Criteria (Summary)

- A developer can log two meals and defer the collision normally — no error, every time.
- A deliberate concurrency test proves two simultaneous defers still can't both succeed.
- The sibling change's previously-blocked Phase 3 tests pass once this fix lands, unblocking that change to resume.
