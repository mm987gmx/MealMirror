<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Meal & Check-in Data Schema Implementation Plan

- **Plan**: context/changes/meal-checkin-data-schema/plan.md
- **Mode**: Deep
- **Date**: 2026-09-12
- **Verdict**: SOUND
- **Findings**: 0 critical, 2 warnings, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | PASS |

## Grounding

5/5 paths ✓ (src/lib/supabase.ts, src/middleware.ts, CLAUDE.md, package.json, supabase/config.toml), 3/3 symbols ✓ (ESLint strictTypeChecked confirmed, Postgres 17 gen_random_uuid built-in confirmed, no existing profiles table confirmed), brief↔plan ✓

## Findings

### F1 — Phase 2's automated verification can't actually catch schema drift

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 — TypeScript types
- **Detail**: ESLint's type-checked rules (strictTypeChecked + projectService: true) do real type-aware linting, but hand-written `src/types.ts` would have no consumer yet (S-01 not built) to expose a mismatched field via lint/build.
- **Fix A ⭐ Recommended**: Generate types via `npx supabase gen types typescript --local --schema public` instead of hand-writing them; re-export clean `Meal`/`CheckIn` aliases over the generated shape.
  - Strength: Structurally impossible to drift — types come directly from the applied schema.
  - Tradeoff: Generated shape is verbose; needs a thin re-export layer for ergonomics.
  - Confidence: HIGH — standard, documented Supabase CLI workflow.
  - Blind spot: Team's preferred ergonomics for the generated shape not confirmed.
- **Fix B**: Keep hand-written types, add an explicit drift-check script comparing `information_schema.columns` against the interfaces.
  - Strength: Keeps clean type names without generated-file verbosity.
  - Tradeoff: Extra tooling; scales worse as S-02 adds columns.
  - Confidence: MEDIUM.
- **Decision**: FIXED (Fix A) — Phase 2 rewritten to generate `src/database.types.ts` via Supabase CLI and re-export `Meal`/`CheckIn` from it in `src/types.ts`. Progress section and plan-brief.md updated to match.

### F2 — No rollback note if the migration needs reverting

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Migration Notes
- **Detail**: Migration Notes didn't state what to do if Phase 1 needs reverting after being pushed remotely. Risk is low (first migration, no user data yet) but was left unstated.
- **Fix**: Add one sentence: "If this migration needs reverting after being applied, write a follow-up migration dropping both tables — safe at this stage since no user data exists yet."
- **Decision**: FIXED — sentence added to Migration Notes in plan.md.
