# Meal & Check-in Data Schema Implementation Plan

## Overview

Create the first Supabase migration for MealMirror: `meals` and `check_ins` tables with row-level security scoped to the owning user, plus matching TypeScript types in `src/types.ts`. This is roadmap item F-01 — a foundation with no user-visible outcome on its own, but it unlocks every downstream vertical slice (S-01 north star, S-02, S-04).

## Current State Analysis

- `supabase/migrations/` does not exist yet — this is the first migration in the project.
- `src/types.ts` does not exist yet — no shared domain types defined.
- Auth is already implemented (`src/lib/supabase.ts`, `src/middleware.ts`) — `auth.users` and `auth.uid()` are available to reference and to scope RLS policies.
- `CLAUDE.md` conventions: migrations live in `supabase/migrations/` named `YYYYMMDDHHmmss_short_description.sql`; every new table must ship RLS enabled with granular per-operation, per-role policies in the same migration file.

## Desired End State

`meals` and `check_ins` tables exist in the Supabase schema (local and, once pushed, remote), each with row-level security enabled and four policies (select/insert/update/delete) scoped to `auth.uid() = user_id`. `src/types.ts` exports `Meal` and `CheckIn` interfaces that mirror the migration's columns exactly.

Verified by: `npx supabase db reset` applies the migration with no errors, both tables report `relrowsecurity = true` with exactly 4 policies each, and `npm run lint` / `npm run build` pass with `src/types.ts` in place.

### Key Discoveries:

- No prior migration exists — no naming precedent to match beyond the `CLAUDE.md` convention.
- `check_ins.kind` is scoped to `'post_meal'` only for this migration (enforced by a `CHECK` constraint) — S-02 widens it later with a constraint change, not a new column or backfill.
- Check-in lifecycle (pending / completed / deferred) is derived from `completed_at` (`null` = pending) and `superseded_by` (self-referencing FK for the defer chain) rather than a separate `status` column, per the interview decision — fewer redundant state fields to keep in sync.

## What We're NOT Doing

- No API endpoints for meals/check-ins (S-01's job).
- No UI for logging meals or completing check-ins (S-01's job).
- No morning/evening check-in columns or logic (S-02's job) — the `kind` column exists but is constrained to `'post_meal'` only.
- No quiet-hours fields (S-04's job).
- No export logic (S-05's job).
- No seed data or fixtures.

## Implementation Approach

One migration file creates both tables and all RLS policies together (Supabase applies each migration file as a single transaction, so there's no partial-apply risk). A second, independent phase adds the TypeScript types that mirror the migration's exact column list — kept separate so each phase has its own verification tool (`supabase db reset` vs `npm run lint`/`build`).

## Phase 1: Migration — meals & check_ins tables with RLS

### Overview

Creates both tables and enables RLS with four policies per table, scoped to the owning user.

### Changes Required:

#### 1. New migration file

**File**: `supabase/migrations/20260912170135_meal_checkin_schema.sql`

**Intent**: Establish the minimal data model for FR-001 (log a meal) and FR-004 (complete a post-meal check-in), extensible by later slices without breaking changes — `kind` and the self-referencing `superseded_by` exist now so S-02 and the defer logic in S-01 don't require a schema rename.

**Contract**:

```sql
create table public.meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  occurred_at timestamptz not null,
  description text not null,
  created_at timestamptz not null default now()
);

create table public.check_ins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  meal_id uuid references public.meals(id) on delete cascade,
  kind text not null default 'post_meal' check (kind = 'post_meal'),
  due_at timestamptz not null,
  completed_at timestamptz,
  superseded_by uuid references public.check_ins(id) on delete set null,
  stomach_pain boolean,
  heartburn boolean,
  bloating boolean,
  bowel_issues boolean,
  general_wellbeing boolean,
  dry_mouth boolean,
  created_at timestamptz not null default now()
);

alter table public.meals enable row level security;
alter table public.check_ins enable row level security;

create policy "meals_select_own" on public.meals for select using (auth.uid() = user_id);
create policy "meals_insert_own" on public.meals for insert with check (auth.uid() = user_id);
create policy "meals_update_own" on public.meals for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "meals_delete_own" on public.meals for delete using (auth.uid() = user_id);

create policy "check_ins_select_own" on public.check_ins for select using (auth.uid() = user_id);
create policy "check_ins_insert_own" on public.check_ins for insert with check (auth.uid() = user_id);
create policy "check_ins_update_own" on public.check_ins for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "check_ins_delete_own" on public.check_ins for delete using (auth.uid() = user_id);
```

### Success Criteria:

#### Automated Verification:

- `npx supabase start` reports the local stack is running (start it if not already up)
- `npx supabase db reset` applies the migration with no SQL errors
- A verification query confirms RLS is on and policy counts match: `select relname, relrowsecurity from pg_class where relname in ('meals','check_ins');` returns `t` for both, and `select tablename, count(*) from pg_policies where tablename in ('meals','check_ins') group by tablename;` returns 4 for each

#### Manual Verification:

- Open local Supabase Studio (`npx supabase status` for the URL) and confirm both tables exist with the columns listed above
- In the SQL editor, run a `select` against `meals` or `check_ins` as the `anon` role and confirm it returns 0 rows (RLS blocks unauthenticated access)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: TypeScript types

### Overview

Generates `src/database.types.ts` directly from the applied schema via the Supabase CLI, then adds a thin `src/types.ts` re-export with clean `Meal`/`CheckIn` names — so the types are structurally guaranteed to match Phase 1's schema instead of being hand-typed and risking drift. (Revised during plan review, finding F1: hand-written types would have no consumer yet to catch a mismatched field via lint/build.)

### Changes Required:

#### 1. Generated schema types

**File**: `src/database.types.ts`

**Intent**: Source of truth for the database shape, generated — never hand-edited — so it can never silently drift from the real schema.

**Contract**: Produced by `npx supabase gen types typescript --local --schema public > src/database.types.ts`. Exposes `Database["public"]["Tables"]["meals"]["Row"]` and `Database["public"]["Tables"]["check_ins"]["Row"]`.

#### 2. Shared domain type aliases

**File**: `src/types.ts`

**Intent**: Give downstream slices (starting with S-01) clean, importable names instead of the verbose generated path.

**Contract**:

```ts
import type { Database } from "./database.types";

export type Meal = Database["public"]["Tables"]["meals"]["Row"];
export type CheckIn = Database["public"]["Tables"]["check_ins"]["Row"];
export type CheckInKind = CheckIn["kind"];
```

### Success Criteria:

#### Automated Verification:

- `npx supabase gen types typescript --local --schema public > src/database.types.ts` runs with no errors and produces a non-empty file
- `npm run lint` passes
- `npm run build` succeeds

#### Manual Verification:

- Open `src/database.types.ts` and confirm the `meals` and `check_ins` `Row` types list every column from the Phase 1 migration with matching nullability

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- None — no test runner is configured in this project (`CLAUDE.md`: "No test suite is configured yet"). Correctness is verified via the automated/manual criteria above.

### Integration Tests:

- `npx supabase db reset` acts as the integration check for the migration (applies against a real local Postgres instance, not a mock).

### Manual Testing Steps:

1. Run `npx supabase db reset` and confirm no errors.
2. Open Supabase Studio locally and visually confirm both tables and their columns.
3. In the SQL editor, attempt a `select` as `anon` against both tables and confirm RLS returns zero rows.
4. Run `npm run lint` and `npm run build` after Phase 2 and confirm both succeed.

## Performance Considerations

None — this is a schema-only foundation with no query patterns yet; indexing beyond the primary keys and foreign keys is deferred until S-01/S-03 reveal real access patterns (e.g., an index on `check_ins.user_id, due_at` for the pending-queue query).

## Migration Notes

This is the first migration in the project — no existing data to migrate or backfill. If this migration needs reverting after being applied, write a follow-up migration dropping both tables — safe at this stage since no user data exists yet.

## Addenda

- **ESLint override for generated types (post-implementation, unplanned)**: Phase 2's `src/database.types.ts` trips `@typescript-eslint/no-redundant-type-constituents` on its boilerplate `Enums`/`CompositeTypes` helper generics, which resolve to `never` when the schema has no enums or composite types. `eslint.config.js` gained a `generatedTypesConfig` block scoped to `files: ["src/database.types.ts"]` disabling only that rule for that one file — the rule stays fully active everywhere else. Flagged by impl-review (F2, OBSERVATION); recorded here rather than in Phase 2's read-only "Changes Required" section.
- **RLS fix (post-implementation)**: Impl-review (F1, WARNING) found `check_ins_insert_own`/`check_ins_update_own` didn't validate `meal_id` ownership. Fixed via follow-up migration `20260912170136_check_ins_meal_ownership.sql` — see `reviews/impl-review.md`.

## References

- Roadmap item: `context/foundation/roadmap.md` — F-01 (`meal-checkin-data-schema`)
- GitHub issue: https://github.com/mm987gmx/MealMirror/issues/1
- PRD: `context/foundation/prd.md` — Access Control, Business Logic (defer rule), FR-001, FR-004

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Migration — meals & check_ins tables with RLS

#### Automated

- [x] 1.1 `npx supabase start` reports the local stack is running — cd523fc
- [x] 1.2 `npx supabase db reset` applies the migration with no SQL errors — cd523fc
- [x] 1.3 Verification query confirms RLS enabled and 4 policies per table — cd523fc

#### Manual

- [x] 1.4 Supabase Studio shows both tables with expected columns — cd523fc
- [x] 1.5 `anon`-role select against either table returns 0 rows — cd523fc

### Phase 2: TypeScript types

#### Automated

- [x] 2.1 `npx supabase gen types typescript --local --schema public > src/database.types.ts` runs with no errors and produces a non-empty file — 8c11704
- [x] 2.2 `npm run lint` passes — 8c11704
- [x] 2.3 `npm run build` succeeds — 8c11704

#### Manual

- [x] 2.4 `src/database.types.ts` Row types match the Phase 1 migration column-for-column — 8c11704
