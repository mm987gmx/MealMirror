# Critical-Path Collision & Invariant Coverage — Plan Brief

> Full plan: `context/changes/testing-collision-invariant-coverage/plan.md`
> Research: `context/changes/testing-collision-invariant-coverage/research.md`

## What & Why

Bootstrap this project's test tooling from zero and write the first automated tests for the two highest-priority risks in the test plan: the meal-collision/defer chain corrupting traceability under 3+ meals (Risk #1), and the single-active-check-in invariant breaking under concurrent requests (Risk #2). This is rollout Phase 1 of `context/foundation/test-plan.md`.

## Starting Point

Zero test infrastructure exists anywhere in the repo. The domain code is already implemented and, per a prior fix (commit `20cc899`), the concurrency invariant is already enforced by a DB-level partial unique index with correct error translation — research confirmed this works end-to-end. What's unverified is the 3+ meal collision chain: the code handles it mechanically fine, but only the most recent meal in a defer chain ever ends up with a completable check-in — earlier meals silently get none, and no document ever specified whether that's intended.

## Desired End State

`npm test` runs a Vitest suite proving the collision chain's behavior at 1, 2, and 3 meals and the invariant holding under two concurrent-request scenarios; `npm run test:e2e` runs one Playwright test proving the resulting friendly error is visible in a real browser. `npm run typecheck` exists. The test-plan's cookbook (§6) documents the conventions this phase establishes for every later phase to reuse.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| 3-meal chain semantics | Document as known gap, don't fix | Respects this lesson's boundary against bug-fix workflows while not silently blessing data loss as "correct" | Plan (user-confirmed) |
| Route testing architecture | Call exported handler directly with a fake APIContext | Proves the real isUniqueViolation→friendly-redirect path cheaply, without a full server process | Plan (user-confirmed) |
| Test auth provisioning | Admin-create a throwaway Supabase user per test | Deterministic, isolated, avoids shared-state pollution of the very invariant under test | Plan (user-confirmed) |
| Test data isolation | Fresh throwaway user per test case | Cascade-deletes meals/check-ins with the user; strongest isolation for the race tests | Plan (user-confirmed) |
| E2E scope | One Playwright test, scoped to the collision/defer flow | Test plan explicitly allows a narrowly-scoped e2e test for this exact flow | Plan (user-confirmed) |
| Typecheck script | Add `npm run typecheck` now, CI wiring deferred | Satisfies Quality Gates §5's stated trigger at near-zero cost; CI YAML is out of scope for this lesson chain | Plan (user-confirmed) |
| Test file location | Co-located with source (`*.test.ts` next to the file) | Matches this project's flat `src/lib/services/` layout, no new top-level tree | Plan (user-confirmed) |
| Local Supabase startup | Automatic via a `pretest` script that never stops the stack | Zero-friction `npm test`, without risking killing a developer's already-running instance | Plan (user-confirmed) |
| Route-handler auth | Reuse `@supabase/ssr`'s own cookie-serialization via a fake browser client | Avoids hand-reimplementing a version-fragile cookie encoding format | Plan (research-grounded) |

## Scope

**In scope:**
- Vitest + Playwright bootstrap, `typecheck` script, Supabase auto-start helper
- Test harness helpers: throwaway-user admin client, route-handler auth/cookie simulation
- Integration tests for the 1/2/3-meal collision chain (service layer)
- Integration tests for the concurrent meal-create and concurrent-defer races (route layer)
- One Playwright e2e test for the same race, verifying visible UI error
- `test-plan.md` §6 cookbook update

**Out of scope:**
- Fixing the 3-meal traceability gap (flagged, not fixed)
- 4+ meal collision enumeration
- CI/CD YAML changes
- Cross-user access testing (Risk #6 — Phase 2 of the rollout)
- Any schema/migration changes

## Architecture / Approach

Two auth patterns, chosen per what each risk needs: Risk #1's service-layer functions already take a `SupabaseClient` parameter, so tests just sign in a throwaway user and call them directly — no cookie machinery required. Risk #2 needs to prove the *route handler's* error translation, so those tests invoke the exported `POST` functions directly against a fake `APIContext`, authenticated via a real session cookie built by reusing `@supabase/ssr`'s own browser-client cookie serialization. Both layers run against a real local Postgres instance (`npx supabase start`, auto-started), never mocks.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Test tooling bootstrap | Vitest/typecheck/auto-start scripts, env scaffolding | Astro adapter + Vitest env interop is unverified — gated by a smoke test |
| 2. Test harness helpers | Throwaway-user + cookie-auth helpers, first unit test | Cookie-encoding technique must actually authenticate — proven by its own smoke test |
| 3. Risk #1 coverage | 1/2/3-meal collision chain integration tests | 3-meal assertions must document the gap, not paper over it |
| 4. Risk #2 coverage | Concurrent race integration tests via real route handlers | A single green run isn't enough evidence for a concurrency test — repeated-run criterion included |
| 5. E2E scoped check | One Playwright test for the same race | Two-browser-context concurrent submit could be flaky — kept to exactly one scoped test |
| 6. Cookbook update | test-plan.md §6.1–§6.3 filled in | None — documentation only |

**Prerequisites:** Docker running (for `npx supabase start`); local Supabase project already configured (`supabase/config.toml` present).
**Estimated effort:** ~4-6 implementation sessions across 6 phases — Phase 1-2 (tooling) is the highest-uncertainty part; Phases 3-4 (the actual risk coverage) are mostly mechanical once the harness works.

## Open Risks & Assumptions

- Whether `getViteConfig` + `.env.test` actually populates `astro:env/server` under this Astro/Cloudflare-adapter combination is unverified until Phase 1's smoke test runs — a documented fallback exists if it fails.
- The 3-meal chain's "last-meal-wins" behavior remains an open product question after this phase (by design) — a future change should make an explicit decision rather than leaving it implicit.
- Concurrency tests firing two `Promise.all`-wrapped calls in-process may not always reproduce the exact same race window as truly independent HTTP connections; the repeated-run criterion (Phase 4) mitigates but doesn't eliminate flakiness risk.

## Success Criteria (Summary)

- A developer can run `npm test` (auto-starting Supabase if needed) and see the 3-meal chain's actual behavior and the concurrency invariant both proven, not asserted informally.
- `npm run test:e2e` proves the friendly error is visible in a real browser for the same race.
- The next test-plan rollout phase can follow §6's cookbook entries without re-deriving these decisions.
