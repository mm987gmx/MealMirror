<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Post-Meal Check-in Loop Implementation Plan

- **Plan**: context/changes/post-meal-checkin-loop/plan.md
- **Scope**: Phase 1 of 3 (full plan — all 3 phases complete)
- **Date**: 2026-09-12
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — `deferCheckIn` has a check-then-act race on concurrent collision resolution

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/check-ins.ts:40-54
- **Detail**: Two concurrent "defer" submissions (double-click, or two tabs) each independently insert a new check-in via `scheduleCheckIn`, then both `UPDATE ... WHERE id = activeCheckInId`. Both inserts succeed — only one wins the `superseded_by` race — leaving two simultaneously "active" check-ins (both `completed_at is null AND superseded_by is null`), which breaks the single-active-check-in invariant the whole feature depends on. No DB constraint currently prevents this.
- **Fix A ⭐ Recommended**: Add a partial unique index on `check_ins(user_id) WHERE completed_at IS NULL AND superseded_by IS NULL`, and let the second concurrent insert fail with a unique-violation that the route layer redirects as a friendly error.
  - Strength: Enforces the invariant at the data layer — the one place that can't be bypassed by a future caller forgetting to check first.
  - Tradeoff: Requires a new migration; the failed second request needs a specific error-redirect message instead of a generic 500.
  - Confidence: HIGH — standard Postgres pattern for "at most one active row per user" invariants.
  - Blind spot: None significant for a single-user MVP.
- **Fix B**: Leave as-is for now — single-user app, human-paced UI interactions make true concurrent double-submits unlikely before S-02+ adds more traffic patterns.
  - Strength: Zero work now.
  - Tradeoff: Silent data corruption risk stays latent; harder to debug if it ever fires.
  - Confidence: MEDIUM — depends on how "single-user" the MVP truly stays.
  - Blind spot: Haven't checked if any client-side double-submit guard already exists on the collision buttons.
- **Decision**: FIXED (Fix A) — partial unique index added via `supabase/migrations/20260912183849_check_ins_one_active_per_user.sql`; `meals.ts`/`check-ins/collision.ts` now catch the resulting `23505` and show a friendly "please refresh and try again" message via a new `src/lib/services/postgres-errors.ts` helper. Verified: a second concurrent active check-in is correctly rejected by Postgres.

### F2 — `createMealWithCheckIn` has the same check-then-act race for initial collision detection

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/meals.ts:14-33
- **Detail**: `findActiveCheckIn` then `scheduleCheckIn` with no transaction/lock — two concurrent meal-logging requests could both see "no active check-in" and both schedule one, defeating collision detection for that pair. Same root cause and same fix as F1.
- **Fix**: Covered by F1's partial unique index — no separate fix needed once F1 lands.
- **Decision**: FIXED — resolved as a side effect of F1's partial unique index (same invariant, same migration).

### F3 — Collision-view dashboard queries rely solely on RLS, not explicit `user_id` scoping

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/dashboard.astro:27-29
- **Detail**: The collision-view reads (`check_ins`/`meals` by id from URL query params `collision`/`meal`) don't add `.eq("user_id", user.id)`, unlike the service layer's writes which consistently defense-in-depth alongside RLS. Not currently exploitable — RLS policies correctly scope by `auth.uid() = user_id` — but it's the one read path in this feature that doesn't match the stated principle that RLS shouldn't be the only layer.
- **Fix**: Add `.eq("user_id", user.id)` to both collision-view queries in dashboard.astro.
- **Decision**: FIXED — both queries now scope explicitly by `user_id` in addition to RLS.

## Verification (Step 3)

**Automated** (re-run at review time): `npm run lint` — PASS; `npm run build` — PASS.

**Manual**: All Manual Progress rows (1.3, 2.3, 2.4, 3.3–3.7) carry commit SHAs and were confirmed interactively by the user during the `/10x-implement` session — end-to-end curl-based verification of meal logging, collision keep/defer, and check-in completion, cross-checked against the database. Not rubber-stamped.

## Cross-cutting notes (not findings — no action needed)

- Two files touched outside the plan's "Changes Required" (`src/lib/supabase.ts`'s `Database` generic, and migration `20260912173705_meal_checkin_table_grants.sql`) were both discovered and explicitly approved by the user live during Phase 1 (a real infrastructure bug: F-01 never granted base table privileges, so RLS was unreachable). Not scope creep — necessary, disclosed, and already documented in their commit messages.
- IDOR check passed: all three API routes derive scoping exclusively from `context.locals.user.id`, never from client input; service-layer `UPDATE`s scope by both `id` and `user_id`; a forged `mealId` for another user's meal is independently blocked by the `check_ins_insert_own`/`update_own` RLS policies (from the F-01 follow-up fix).
- Checkbox field names verified to match exactly between `dashboard.astro`'s rendered inputs and `checkInCompletionSchema`.
