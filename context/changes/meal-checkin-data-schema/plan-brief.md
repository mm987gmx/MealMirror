# Meal & Check-in Data Schema — Plan Brief

> Full plan: `context/changes/meal-checkin-data-schema/plan.md`

## What & Why

MealMirror's roadmap (F-01) needs a data foundation before any user-facing slice can be built: `meals` and `check_ins` tables, scoped to the owning user via RLS. This is the first piece of the milestone — every downstream slice (S-01 north star, S-02, S-04) reads or writes this schema.

## Starting Point

No `supabase/migrations/` directory exists yet — this is the project's first migration. Auth is already implemented (Supabase `@supabase/ssr`, middleware-based route protection), so `auth.users` / `auth.uid()` are available to reference and to scope RLS policies. No `src/types.ts` exists yet either.

## Desired End State

`meals` and `check_ins` tables exist with RLS enabled and four per-operation policies each (select/insert/update/delete), all scoped to `auth.uid() = user_id`. `src/types.ts` re-exports `Meal` and `CheckIn` as clean aliases over CLI-generated schema types, ready for S-01 to build against.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Symptom storage | Fixed boolean columns (one per FR-004 symptom) | Full typing and simple SQL for future co-occurrence queries; matches the roadmap's "no premature columns" rule since only FR-004's known set is added now |
| Check-in type discriminator | `kind` column now, `CHECK (kind = 'post_meal')` | S-02 widens via a trivial constraint change instead of adding a column + backfilling existing rows |
| Meal timestamp | Single `occurred_at timestamptz` | Directly supports the "90 minutes after the meal" scheduling rule without combining two columns in application logic |
| Check-in lifecycle | `completed_at` (null = pending) + `superseded_by` (self-FK) | Fewer redundant state fields than a separate `status` enum — one less thing that can drift out of sync |
| TypeScript types timing | Created now, in this same change | Schema and types land together so they can't silently diverge from day one |
| TypeScript types source | Generated (`supabase gen types`) + thin re-export, not hand-written | Plan review (F1): hand-written types have no consumer yet to catch a mismatch via lint/build; generated types can't drift from the schema by construction |

## Scope

**In scope:** `meals` table, `check_ins` table, RLS + 8 policies, generated `src/database.types.ts` + `src/types.ts` re-exporting `Meal`/`CheckIn`.

**Out of scope:** API endpoints, UI, morning/evening check-in columns, quiet-hours fields, export logic, seed data.

## Architecture / Approach

One migration file creates both tables and all RLS policies transactionally. A second, independent phase generates TypeScript types straight from the applied schema via the Supabase CLI, then re-exports clean names — separated so each phase has its own verification tool (`supabase db reset` vs. `npm run lint`/`build`).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Migration | `meals` + `check_ins` tables, RLS, 8 policies | Getting the RLS policies wrong would silently leak or block data — verified via an explicit `anon`-role query, not just table existence |
| 2. TypeScript types | Generated `src/database.types.ts` + `src/types.ts` aliases | Low — types are derived from the schema, not hand-typed, so drift is structurally prevented (plan-review finding F1) |

**Prerequisites:** Local Supabase running via `npx supabase start` (Docker required).
**Estimated effort:** One session, two short phases.

## Open Risks & Assumptions

- Assumes `npx supabase start` / Docker is available in the working environment for local verification before any remote push.
- The `kind` CHECK constraint intentionally blocks any value but `'post_meal'` — S-02 must remember to widen it, not just add new symptom columns.

## Success Criteria (Summary)

- `npx supabase db reset` applies cleanly; both tables show RLS on with 4 policies each.
- An unauthenticated (`anon`) query against either table returns zero rows.
- `npx supabase gen types typescript --local` succeeds and `npm run lint` / `npm run build` pass with `src/database.types.ts` + `src/types.ts` in place.
