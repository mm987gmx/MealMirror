<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Critical-Path Collision & Invariant Coverage Implementation Plan

- **Plan**: context/changes/testing-collision-invariant-coverage/plan.md
- **Scope**: Phase 1-6 of 6 (full plan)
- **Date**: 2026-09-13
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — e2e spec closes browser contexts inside `try`, not `finally`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: e2e/collision-race.spec.ts:67-68
- **Detail**: `context1.close()`/`context2.close()` sit inside the `try` block, before the `finally` that deletes the throwaway Supabase user. If any `expect(...)` between page setup and line 67 throws — exactly the collision-race assertions under test, the likeliest failure mode — the two Playwright `BrowserContext`s are never explicitly closed. The Supabase user still gets cleaned up correctly (that's in the `finally`); this is a smaller, secondary leak of browser contexts within the worker process for the rest of that run.
- **Fix**: Move both `.close()` calls into the `finally` block, alongside `deleteTestUser`.
- **Decision**: PENDING

### F2 — Only one flow has adapter-level (e2e) coverage; the meals-create race doesn't

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: astro.config.mjs:20 (the `process.env.VITEST` conditional) and the overall test-layer split
- **Detail**: The Vitest-based tests never actually run through `@astrojs/cloudflare`'s adapter/workerd pipeline — they call route handlers directly against a hand-built fake context, bypassing it entirely. `@astrojs/cloudflare`'s presence can shift Vite's module-resolution `conditions` toward workerd-flavored package exports (of `@supabase/supabase-js`/`@supabase/ssr`/Astro internals); any behavior gated behind such an export is exercised only by the e2e suite, which builds with the real adapter. Today only the collision/defer race has e2e coverage — the meals-creation race (`src/pages/api/meals.test.ts`) has none. A workerd-specific concurrency bug in the meals-creation path specifically would go uncaught by this suite.
- **Fix A ⭐ Recommended**: Accept and document this as a known coverage boundary — adding a second e2e spec would violate this same plan's own "exactly one Playwright spec, scoped to the collision/defer flow" scope decision, and no concrete evidence points to an actual workerd-specific behavior difference in the meals-creation path today.
  - Strength: Matches this project's stated cost×signal philosophy — no risk in the test plan currently justifies a second e2e test for this.
  - Tradeoff: The gap remains latent until/unless a real workerd-specific bug surfaces there.
  - Confidence: HIGH — grounded in the test plan's own explicit e2e-scope decision.
  - Blind spot: None significant.
- **Fix B**: Add a second, narrowly-scoped e2e spec for the meals-creation race.
  - Strength: Closes the coverage gap completely.
  - Tradeoff: Directly contradicts this plan's own "one e2e spec" scope decision for no concrete evidence of a real bug — expands the most expensive, most flake-prone test layer speculatively.
  - Confidence: MEDIUM — no evidence yet that this gap is more than theoretical.
  - Blind spot: Haven't checked whether `@supabase/supabase-js`/`@supabase/ssr` actually ship workerd-specific export conditions that would produce different behavior in practice.
- **Decision**: PENDING

### F3 — `reuseExistingServer: !CI` can silently serve a stale local build

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: playwright.config.ts:26
- **Detail**: Outside CI, if anything is already listening on port 4321 (a leftover `wrangler dev`, a previous interrupted `test:e2e` run), Playwright skips the build+serve command entirely and reuses whatever is already running — silently testing a stale build against current source, with no warning. CI is unaffected (`CI` is always set there, forcing a fresh build every run).
- **Fix**: Add a comment in `playwright.config.ts` documenting this local-only trade-off, matching how the other adaptations in this file are already documented.
- **Decision**: PENDING

### F4 — create→try→finally→delete boilerplate duplicated across 5+ files

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/meals.test.ts, src/pages/api/check-ins/collision.test.ts (both `it` blocks), e2e/collision-race.spec.ts
- **Detail**: Only `src/lib/services/meals.test.ts` factors the throwaway-user lifecycle into a local `withTestUser` helper. The other four call sites re-inline the identical `const admin = ...; const user = await createTestUser(admin); try {...} finally { await deleteTestUser(...) }` shape. Every instance is individually correct — this is a maintainability observation, not a correctness issue.
- **Fix**: Extract a shared `withTestUser`-style combinator into `src/lib/test-support/`, parameterized for the sign-in-client vs. cookie-header variants different callers need.
- **Decision**: PENDING

## Notes (no action needed)

- **Two documented, reasonable adaptations to real environment blockers**, both confirmed by independent re-verification: `astro.config.mjs`'s `VITEST`-conditional adapter removal (fixes a genuine Vitest/Cloudflare-adapter crash) and `playwright.config.ts`'s `npm run build && wrangler dev` webServer (works around a genuine, pre-existing, unrelated `astro dev` crash in this environment). Neither changes production behavior; both are recorded in code comments, commit messages, and the §6 cookbook.
- **Race genuineness, explicitly traced**: the concurrent-defer race (route-level and e2e) is robust by construction — Postgres row-locking on the shared `check_ins` row makes the outcome invariant regardless of timing. The meals-creation race is a genuine but timing-dependent TOCTOU race; if interleaving didn't occur, the test would fail its own assertions loudly rather than passing vacuously — not a silently-fake test.
- **Security**: service-role key handling is clean — never logged, never committed, and structurally excluded from `astro:env/server` (so it can never ship in the app bundle). All data assertions go through the RLS-scoped client, never the admin client — the tests genuinely exercise RLS.
- **Independently re-verified**: full vitest suite (8 files, 19 tests), typecheck, lint, build, the two route-level race tests repeated 3x, the e2e spec, and zero leftover throwaway users in Supabase after a full run — all pass/confirmed.
- **CI gap is deliberate, not an oversight**: `.github/workflows/ci.yml` still runs only lint+build; the plan and test-plan.md both explicitly reserve CI wiring for a later change.
