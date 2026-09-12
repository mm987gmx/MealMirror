<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Meal & Check-in Data Schema Implementation Plan

- **Plan**: context/changes/meal-checkin-data-schema/plan.md
- **Scope**: Phase 1 of 2 (full plan — both phases complete)
- **Date**: 2026-09-12
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | WARNING |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — `check_ins` insert/update RLS policies don't validate `meal_id` ownership

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260912170135_meal_checkin_schema.sql:90-91 (`check_ins_insert_own`, `check_ins_update_own`)
- **Detail**: Both policies check only `auth.uid() = user_id` on `check_ins`. Neither validates that `meal_id` actually belongs to the same user. A user could insert or update a `check_ins` row with their own `user_id` but a `meal_id` pointing at another user's meal (if the UUID is known or guessed). This is not a read leak — `check_ins_select_own` still filters strictly on `check_ins.user_id`, so the attacker only ever sees their own row, and the meal owner never sees the foreign check-in either. So there's no cross-user data exposure today, but it's a referential/data-integrity gap: a check-in can end up "attached" to a meal it has no right to reference.
- **Fix**: Add a `with check` clause to both policies verifying meal ownership, e.g. `meal_id is null or exists (select 1 from public.meals m where m.id = meal_id and m.user_id = auth.uid())`.
- **Decision**: FIXED — follow-up migration `supabase/migrations/20260912170136_check_ins_meal_ownership.sql` adds the ownership check to both policies.

### F2 — Unplanned `eslint.config.js` addition

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: eslint.config.js (new `generatedTypesConfig` block)
- **Detail**: Not mentioned in the plan. Adds an override disabling `@typescript-eslint/no-redundant-type-constituents`, scoped via `files: ["src/database.types.ts"]` to that one generated file only, because the CLI's boilerplate `Enums`/`CompositeTypes` helper generics resolve to `Record<never, never>` on a schema with no enums/composite types and trip that rule. `baseConfig` (where the rule is inherited from `tseslint.configs.strictTypeChecked`) is untouched, so the rule stays fully active everywhere else. Correctly scoped, no drift risk — but the plan should ideally have flagged this as a known consequence of "generated, never hand-edited" types files.
- **Fix**: None required — document in the plan as an addendum for future reference.
- **Decision**: PENDING

### F3 — `meal_id` nullable while `kind` is hard-constrained to `'post_meal'`

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: supabase/migrations/20260912170135_meal_checkin_schema.sql:67
- **Detail**: `check_ins.meal_id` is nullable, but `kind` is constrained to the single value `'post_meal'` today. Every check-in in current scope is meal-anchored, so `meal_id` could arguably be `not null` right now. Leaving it nullable is a reasonable bet on S-02 (fixed daily check-ins) needing non-meal-anchored rows, but nothing in the plan or migration comments documents that intent.
- **Fix**: No change needed now — add a one-line migration comment noting `meal_id` is deliberately nullable in anticipation of S-02's non-meal-anchored `kind` values, so a future reader doesn't mistake it for an oversight.
- **Decision**: PENDING

### F4 — No indexes on `user_id` / `meal_id` / `due_at`

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260912170135_meal_checkin_schema.sql (table definitions)
- **Detail**: No explicit indexes on `meals.user_id`, `check_ins.user_id`, `check_ins.meal_id`, or `check_ins.due_at`. RLS predicates and future queries (e.g., "check-ins due now") will filter on these. Low priority for a foundation migration with no data yet — the plan's own Performance Considerations section already defers this to S-01/S-03 by design.
- **Fix**: None required now — plan already tracks this as deferred; no action needed until S-01 reveals real access patterns.
- **Decision**: PENDING

## Verification (Step 3)

**Automated** (re-run at review time):
- `npm run lint` — PASS
- `npm run build` — PASS
- RLS check: `meals` and `check_ins` both `relrowsecurity = t`, 4 policies each — PASS

**Manual**: All 5 manual Progress items (1.4, 1.5, 2.4) were confirmed interactively by the user during the `/10x-implement` session (Supabase Studio table/column check, anon-role select returning 0 rows, generated types column-for-column match) — not rubber-stamped, each had an explicit user confirmation turn.
