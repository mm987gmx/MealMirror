---
date: 2026-09-13T14:31:45+02:00
researcher: mm987gmx (via Claude Code)
git_commit: 67d6362cc378a4d07c14314345619a7dafb237a2
branch: main
repository: mm987gmx/MealMirror
topic: "Critical-path collision & invariant coverage (test-plan Phase 1: Risk #1 and Risk #2)"
tags: [research, codebase, meals, check-ins, collision, concurrency, invariant, testing]
status: complete
last_updated: 2026-09-13
last_updated_by: mm987gmx (via Claude Code)
---

# Research: Critical-path collision & invariant coverage

**Date**: 2026-09-13T14:31:45+02:00
**Researcher**: mm987gmx (via Claude Code)
**Git Commit**: 67d6362cc378a4d07c14314345619a7dafb237a2
**Branch**: main
**Repository**: mm987gmx/MealMirror

## Research Question

This is rollout Phase 1 of `context/foundation/test-plan.md`: "Critical-path collision & invariant coverage." Ground two risks in the current codebase so `/10x-plan` can design real tests against them, not assumptions:

- **Risk #1**: A third (or later) meal logged while an earlier deferred check-in is still pending corrupts the active-check-in chain, losing traceability between a specific meal and its symptom.
- **Risk #2**: The "one active check-in per user" invariant is violated under near-simultaneous requests, producing duplicate active check-ins.

Per the test plan's Risk Response Guidance (§2), research must ground: exact chain semantics on repeated defer; whether "keep" behaves identically on a 3rd collision as on the 2nd; ordering guarantees for near-simultaneous meal inserts; how a constraint violation on concurrent creation is translated into an API/user-facing error; and whether the UI surfaces it or fails silently.

## Summary

**Risk #1 is real, but it is a behavioral/traceability gap, not a mechanical bug.** The collision-resolution code (`resolveCollision` → `deferCheckIn`/keep-no-op) is stateless per call and handles a 3rd, 4th, or Nth collision through the *exact same code path* as the 2nd — there is no off-by-one logic, no array-indexing bug, no special-casing that would break mechanically at N≥3. However, the "defer" chain is a single forward-pointing link (`superseded_by`, old→new) that is never read or traversed anywhere in the codebase. Each check-in's symptom data is tied only to its own `meal_id`, so after a chain of defers, **only the most recent meal in the chain ever gets a completed check-in** — earlier meals in the chain (and, if "keep" was chosen anywhere in the chain, the meal that was "kept over") silently end up with **no completed check-in at all**. This is asserted as an intentional generalization in the archived plan (`context/archive/2026-09-12-post-meal-checkin-loop/plan.md:28`) but was never itself stated as a PRD requirement, never given an acceptance criterion, and never manually tested beyond 2 meals. A test must decide — by asserting the PRD's stated rule, not by asserting whatever the code currently does — whether "last-meal-wins, earlier meals lose their check-in" is the correct 3rd-collision behavior, and must prove the exact DB state (row count, `superseded_by` pointers, `meal_id` values) after a 3-meal keep/defer/defer (and defer/keep) sequence.

**Risk #2 is already substantially mitigated in production code**, via a prior fix (commit `20cc899`) that added a partial unique index `check_ins_one_active_per_user` on `check_ins(user_id) WHERE completed_at IS NULL AND superseded_by IS NULL`. Tracing the full path confirms: every write that could create an "active" row funnels through one function (`scheduleCheckIn`); a concurrent race produces a genuine Postgres `23505` unique-violation on the loser; the error's `.code` property survives the Supabase/postgrest-js round trip without being swallowed by any intermediate catch block; `isUniqueViolation()` correctly detects it in both API routes that can trigger it (`api/meals.ts`, `api/check-ins/collision.ts`); and the resulting friendly message is genuinely rendered in the DOM (not read-and-discarded) via `dashboard.astro`'s error banner and `MealForm`'s `ServerError`. RLS policies allow an authenticated integration-test client to legitimately fire two near-simultaneous inserts for the same user against a local Postgres instance (`npx supabase start`), so the race is directly, realistically testable — no mocking needed. The main testing gap here is not "does protection exist" (it does) but "prove it under an actual concurrent test," since no automated test exists today (no test runner, no test files, no `test` script anywhere in the repo — Phase 1 bootstraps the runner from zero).

## Detailed Findings

### Collision / defer chain semantics (Risk #1)

- `superseded_by` is a **self-referencing FK on `check_ins`, old→new** ([supabase/migrations/20260912170135_meal_checkin_schema.sql#L16](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/supabase/migrations/20260912170135_meal_checkin_schema.sql#L16)): the replaced row's `superseded_by` holds the id of the row that replaces it. There is no back-pointer on the new row, and no array/list structure.
- Each `check_ins` row also carries its own direct `meal_id` FK ([supabase/migrations/20260912170135_meal_checkin_schema.sql#L12](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/supabase/migrations/20260912170135_meal_checkin_schema.sql#L12)) — traceability between a meal and its symptoms is carried by `meal_id`, entirely independent of the supersede chain.
- Meal #1 → check-in created via `scheduleCheckIn` ([src/lib/services/check-ins.ts:29-38](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/src/lib/services/check-ins.ts#L29-L38)) from inside `createMealWithCheckIn` ([src/lib/services/meals.ts:14-33](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/src/lib/services/meals.ts#L14-L33)).
- Meal #2 while #1 is active → `findActiveCheckIn` ([src/lib/services/check-ins.ts:20-27](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/src/lib/services/check-ins.ts#L20-L27)) returns check-in #1 as `collision`; **no new check-in row is created yet**.
- "Keep" (`resolveCollision`, [src/lib/services/meals.ts:35-44](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/src/lib/services/meals.ts#L35-L44)) is a literal no-op — meal #2 (or #3, #N) gets **no check-in of its own**, permanently, unless it later triggers its own future collision cycle.
- "Defer" (`deferCheckIn`, [src/lib/services/check-ins.ts:40-54](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/src/lib/services/check-ins.ts#L40-L54)) inserts a new active check-in tied to the new meal, then sets the old row's `superseded_by` to the new row's id. Excerpt:
  ```ts
  const newCheckIn = await scheduleCheckIn(supabase, userId, mealId);
  const { error } = await supabase
    .from("check_ins")
    .update({ superseded_by: newCheckIn.id })
    .eq("id", activeCheckInId)
    .eq("user_id", userId);
  ```
- Meal #3 arriving while a check-in is still pending (whether that pending check-in is the original or the product of a prior defer) runs through **byte-for-byte the same code path** as meal #2 — `findActiveCheckIn`, `resolveCollision`, `deferCheckIn`/keep. There is no counter, no array, no branch that treats a 2nd resolution differently from a 3rd or 4th. Parameters throughout are singular scalars (`activeCheckInId: string`, `pendingCheckInId: string`), consistent with a single-hop mental model, but this does not cause a mechanical bug at N≥3 — each call only ever inspects "the current active row."
- **No code anywhere reads or traverses `superseded_by`** except to set it ([src/lib/services/check-ins.ts:17](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/src/lib/services/check-ins.ts#L17) filters `.is("superseded_by", null)`; line 49 is the only write). No timeline/history view walks the chain. Confirmed by repo-wide grep for `superseded_by` outside migrations/generated types.
- **Consequence for a 3-meal defer/defer chain**: only the *last* meal in the chain ends up with a completable, active check-in. Every earlier meal in the chain — including one "kept" partway through — permanently has no check-in that will ever be completed for it (its check-in is either superseded-and-dead, or, in the "keep" case, never created at all). Whether this is intended ("last-meal-wins") or a defect depends on reading the PRD's literal rule ("Deferral replaces the pending check-in with a single new check-in due 90 minutes after the second meal") against the fact that this sentence was never extended to a 3rd meal by the PRD itself.
- No locking or transaction wraps `findActiveCheckIn` + `scheduleCheckIn`/`deferCheckIn` — it is a plain check-then-act sequence ([src/lib/services/meals.ts#L26-L32](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/src/lib/services/meals.ts#L26-L32); [src/lib/services/check-ins.ts#L40-L53](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/src/lib/services/check-ins.ts#L40-L53)). The only ordering guarantee against races is the DB-level partial unique index (see Risk #2 below) — it prevents *duplicate active rows*, but says nothing about the *sequential* 3+-meal logic-correctness question, which is a separate concern from the race.

### Concurrency / single-active-check-in invariant (Risk #2)

- Partial unique index ([supabase/migrations/20260912183849_check_ins_one_active_per_user.sql#L6-L8](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/supabase/migrations/20260912183849_check_ins_one_active_per_user.sql#L6-L8)):
  ```sql
  create unique index check_ins_one_active_per_user
    on public.check_ins (user_id)
    where completed_at is null and superseded_by is null;
  ```
- Only one function performs a raw `INSERT INTO check_ins`: `scheduleCheckIn` ([src/lib/services/check-ins.ts:29-38](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/src/lib/services/check-ins.ts#L29-L38)), called from `createMealWithCheckIn`'s no-collision branch ([src/lib/services/meals.ts#L31](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/src/lib/services/meals.ts#L31)) and from `deferCheckIn` ([src/lib/services/check-ins.ts#L46](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/src/lib/services/check-ins.ts#L46)). These are the only two operations that can trigger `23505` against the index; the corresponding `UPDATE ... superseded_by` only ever moves rows *out* of the active set.
- **Full race trace** (two near-simultaneous `POST /api/meals`, or a create racing a defer): both requests' `findActiveCheckIn` SELECT can run before either has inserted (classic check-then-act), both proceed to `scheduleCheckIn`, and the two concurrent `INSERT`s race at the DB. The loser gets Postgres `23505`. `scheduleCheckIn` uses `.insert().select().single()` then `if (error) throw error;` ([src/lib/services/check-ins.ts#L36](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/src/lib/services/check-ins.ts#L36)) — the thrown `PostgrestError` retains `.code`, propagates unhandled through `createMealWithCheckIn` (no intermediate try/catch), into the route handler's catch block. No swallowing point was found anywhere in the chain.
- `isUniqueViolation(err)` ([src/lib/services/postgres-errors.ts:1-4](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/src/lib/services/postgres-errors.ts#L1-L4)) is checked first in both call sites that can hit this index: [src/pages/api/meals.ts#L34](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/src/pages/api/meals.ts#L34) and [src/pages/api/check-ins/collision.ts#L32](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/src/pages/api/check-ins/collision.ts#L32), each producing a friendly redirect message instead of a generic failure.
- **The error is genuinely visible in the DOM**, not just captured in a variable: `dashboard.astro` reads `?error=` ([src/pages/dashboard.astro#L11](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/src/pages/dashboard.astro#L11)) and renders it directly in the collision-view branch ([src/pages/dashboard.astro#L74-L80](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/src/pages/dashboard.astro#L74-L80)), and also passes it as `serverError` into the `MealForm` React island, which renders it via `ServerError` ([src/pages/dashboard.astro#L119](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/src/pages/dashboard.astro#L119); `MealForm.tsx:72`).
- **No bypass path found**: repo-wide grep confirms `scheduleCheckIn` is the only `INSERT INTO check_ins` call site; no client-side Supabase writes exist anywhere in `src/components`; no seed/bulk scripts exist; all three check-in/meal API routes build their Supabase client from the user's session (no service-role write path). The unique index is a DB-level constraint, so it would hold even against a hypothetical future bypass — this is a genuine, not just apparent, closed gap.
- **RLS permits a realistic integration test**: `check_ins_insert_own` ([supabase/migrations/20260912170135_meal_checkin_schema.sql#L34-L37](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/supabase/migrations/20260912170135_meal_checkin_schema.sql#L34-L37), refined by [supabase/migrations/20260912170136_check_ins_meal_ownership.sql](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/supabase/migrations/20260912170136_check_ins_meal_ownership.sql)) allows `insert when auth.uid() = user_id`. An authenticated test client can legitimately fire two `Promise.all`-wrapped requests for the same user and have RLS let both through to Postgres, so the unique index genuinely arbitrates the race under a real local instance — no mocking required. `supabase/config.toml` confirms `npx supabase start` is configured and viable (Postgres on port 54322, `major_version = 17`).
- **Open/unverified by reading alone** (worth a smoke-check inside the test itself, not an assumption): whether the installed `@supabase/supabase-js`/postgrest-js version populates `PostgrestError.code` exactly as `"23505"` was inferred from `isUniqueViolation`'s contract and standard postgrest-js behavior, not verified by execution.

### Test tooling state (baseline for Phase 1's "bootstraps the runner" scope)

- No `test` script in `package.json`; no `vitest`/`jest`/`mocha`/`playwright` dependency; no `vitest.config.*`; no `tests/`/`__tests__/` directories; no `*.test.ts`/`*.spec.ts` files anywhere in the repo. Confirmed by direct search — Phase 1 genuinely starts from zero, consistent with `context/foundation/test-plan.md` §4's "none yet — see Phase 1."
- `supabase/config.toml` exists and defines a full local stack, so integration tests can run against real Postgres via `npx supabase start` rather than mocks, matching the test plan's stated approach (§4: "integration tests hit a local Supabase instance directly... not mocks").

## Code References

- [src/lib/services/meals.ts:14-33](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/src/lib/services/meals.ts#L14-L33) — `createMealWithCheckIn`: insert meal, check for collision, schedule check-in or return collision
- [src/lib/services/meals.ts:35-44](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/src/lib/services/meals.ts#L35-L44) — `resolveCollision`: "keep" no-op / "defer" dispatch
- [src/lib/services/check-ins.ts:10-27](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/src/lib/services/check-ins.ts#L10-L27) — `activeCheckInQuery`/`findActiveCheckIn`: the "active" predicate (`completed_at is null and superseded_by is null`)
- [src/lib/services/check-ins.ts:29-38](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/src/lib/services/check-ins.ts#L29-L38) — `scheduleCheckIn`: the sole `INSERT INTO check_ins`, and thus the sole trigger point for the unique-index race
- [src/lib/services/check-ins.ts:40-54](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/src/lib/services/check-ins.ts#L40-L54) — `deferCheckIn`: new check-in insert + old row's `superseded_by` update
- [src/lib/services/postgres-errors.ts:1-4](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/src/lib/services/postgres-errors.ts#L1-L4) — `isUniqueViolation`: `23505` detection helper
- [src/pages/api/meals.ts:27-40](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/src/pages/api/meals.ts#L27-L40) — meal-log route, collision redirect + unique-violation catch
- [src/pages/api/check-ins/collision.ts:7-39](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/src/pages/api/check-ins/collision.ts#L7-L39) — collision-resolution route, unique-violation catch
- [src/pages/dashboard.astro:11](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/src/pages/dashboard.astro#L11), [:26-38](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/src/pages/dashboard.astro#L26-L38), [:74-114](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/src/pages/dashboard.astro#L74-L114) — error rendering + collision UI
- [supabase/migrations/20260912170135_meal_checkin_schema.sql](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/supabase/migrations/20260912170135_meal_checkin_schema.sql) — base `meals`/`check_ins` schema + RLS
- [supabase/migrations/20260912170136_check_ins_meal_ownership.sql](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/supabase/migrations/20260912170136_check_ins_meal_ownership.sql) — `meal_id` ownership validation in RLS
- [supabase/migrations/20260912173705_meal_checkin_table_grants.sql](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/supabase/migrations/20260912173705_meal_checkin_table_grants.sql) — base table grants (RLS was otherwise unreachable)
- [supabase/migrations/20260912183849_check_ins_one_active_per_user.sql](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/supabase/migrations/20260912183849_check_ins_one_active_per_user.sql) — the partial unique index enforcing the single-active-check-in invariant
- [src/lib/validation/meal-tracking.ts:10-33](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/src/lib/validation/meal-tracking.ts#L10-L33) — `mealInputSchema`, `collisionResolutionSchema`, `checkInCompletionSchema`
- [src/types.ts](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/src/types.ts) — `Meal`/`CheckIn`/`CheckInKind` type aliases over generated Supabase types

## Architecture Insights

- **Check-in lifecycle has no status column** — `completed_at` (null = pending) and `superseded_by` (null = not replaced) jointly encode state, by explicit design decision recorded in the archived schema plan. This means "active" is always a derived predicate, repeated verbatim in three places (`activeCheckInQuery`, the partial unique index, and any future reader) — a future change to one must be mirrored in the others or the invariant silently drifts.
- **Defense-in-depth is a deliberate, repeated project pattern**: RLS is never trusted alone — service-layer writes scope by both `id` and `user_id`, and the archived impl-review explicitly added the same posture to a read path (`dashboard.astro`'s collision-view queries) for consistency. The partial unique index is this pattern's data-layer instance: app-level check-then-act is accepted as inherently racy, and the DB constraint is the actual enforcement point, with the app layer only responsible for translating the resulting error into a decent user message.
- **The supersede chain is write-only in the current codebase.** Nothing reads it for history/traceability. This is significant for Phase 4 (export correctness, Risk #5) as well as this phase: if export is ever asked to reconstruct "what happened to each meal," it cannot rely on `superseded_by` traversal today — it would need to change how superseded rows are represented, or Phase 4 will hit the same gap Risk #1 surfaces here.

## Historical Context (from prior changes)

- [context/archive/2026-09-12-post-meal-checkin-loop/plan.md:28](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/context/archive/2026-09-12-post-meal-checkin-loop/plan.md#L28) — the original plan's explicit (unverified) assumption that the defer rule "generalizes" to a 3rd+ meal collision without further design. This is the exact assumption Risk #1 was opened to test.
- [context/archive/2026-09-12-post-meal-checkin-loop/plan.md:193-195,216-217,273-275](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/context/archive/2026-09-12-post-meal-checkin-loop/plan.md#L193-L195) — every manual acceptance step and executed Progress entry for collision handling covers exactly 2 meals; none covers 3+.
- [context/archive/2026-09-12-post-meal-checkin-loop/reviews/impl-review.md](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/context/archive/2026-09-12-post-meal-checkin-loop/reviews/impl-review.md) (findings F1/F2) — the original discovery of the check-then-act race that Risk #2 targets, and the design rationale for the partial unique index this research verified is correctly wired end-to-end.
- [context/archive/2026-09-12-meal-checkin-data-schema/plan.md:55-79](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/context/archive/2026-09-12-meal-checkin-data-schema/plan.md#L55-L79) — original schema design intent for `superseded_by`/`completed_at`, confirming the "no status column" decision was deliberate, not an oversight.
- `context/foundation/prd.md` (Business Logic, describing collision/defer) — states the rule only in terms of a second meal; never extended to a third.

## Related Research

None yet — this is the first `/10x-research` artifact under `context/changes/`.

## Open Questions

1. **Product decision needed, not just a test**: is "last-meal-wins, earlier meals in a 3+-hop chain get no completed check-in" the intended behavior, or should the PRD/plan be revisited before writing an assertion that locks it in? The test plan's own guidance (§2, Risk #1 "Must challenge") flags this exact tension — research cannot resolve a product decision, only surface that it hasn't been made explicitly for N≥3.
2. Whether `PostgrestError.code` is reliably `"23505"` on the currently installed `@supabase/supabase-js`/postgrest-js version was inferred, not executed — worth a one-line smoke assertion inside the Phase 1 integration test itself rather than treating it as guaranteed.
3. Whether "keep" leaving a meal permanently without any check-in (2-meal case, already-shipped behavior) is itself acceptable product behavior is out of this phase's scope (it's already shipped and accepted), but is directly relevant context for how strict the 3rd-collision assertion should be.
