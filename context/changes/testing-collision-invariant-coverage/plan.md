# Critical-Path Collision & Invariant Coverage Implementation Plan

## Overview

Bootstrap this project's test tooling from zero and write the first automated tests for the two highest-priority risks in `context/foundation/test-plan.md` §3 Phase 1: the meal-collision/defer chain (Risk #1) and the single-active-check-in invariant under concurrency (Risk #2). This phase also establishes the testing conventions (file location, auth simulation, harness helpers) that every later test-plan rollout phase will reuse via §6 Cookbook Patterns.

## Current State Analysis

No test runner, config, or test files exist anywhere in the repo (confirmed by `context/changes/testing-collision-invariant-coverage/research.md`). The domain code this phase targets:

- **Collision/defer chain** (Risk #1): `createMealWithCheckIn` and `resolveCollision` in `src/lib/services/meals.ts`, backed by `findActiveCheckIn`/`scheduleCheckIn`/`deferCheckIn` in `src/lib/services/check-ins.ts`. The "active check-in" predicate (`completed_at IS NULL AND superseded_by IS NULL`) is repeated in three places (the query helper, the DB partial unique index, and — implicitly — every reader). `superseded_by` is a write-only, forward-pointing (old→new) self-FK; nothing in the codebase ever reads it back. Confirmed in `research.md`: after a 3-meal defer chain, only the most recent meal ends up with a completable check-in — earlier meals in the chain permanently get none. This was an explicit but unverified assumption in the archived `post-meal-checkin-loop` plan, never stated in the PRD past the 2-meal case, and never tested.
- **Single-active-check-in invariant** (Risk #2): enforced by the partial unique index `check_ins_one_active_per_user` (`supabase/migrations/20260912183849_check_ins_one_active_per_user.sql`), added by a prior fix (commit `20cc899`). `scheduleCheckIn` is the sole `INSERT INTO check_ins`; a concurrent race produces Postgres `23505`, detected by `isUniqueViolation` (`src/lib/services/postgres-errors.ts`) in both `src/pages/api/meals.ts` and `src/pages/api/check-ins/collision.ts`, and rendered visibly via `dashboard.astro`'s `?error=` banner. `research.md` traced this end-to-end and found no swallowing point and no bypass path — the mechanism works; this phase's job is to prove it under real concurrency, not fix anything.
- **Auth**: API routes build their own Supabase client per-request via `createClient(context.request.headers, context.cookies)` (`src/lib/supabase.ts`), which uses `@supabase/ssr`'s cookie-based session storage — not a bearer token. Calling a route handler directly in a test therefore requires a real, correctly-encoded session cookie, not just a signed-in client instance.
- **Build**: Astro 7 on Vite (peer `astro@7.0.6` → `vite@^8.0.13`), TypeScript strict, `@/*` → `./src/*` alias, Cloudflare adapter (`@astrojs/cloudflare`), `output: "server"`. `astro:env/server` is a virtual module supplying `SUPABASE_URL`/`SUPABASE_KEY` (both `optional: true`). Local Supabase is configured (`supabase/config.toml`, Postgres on 54322) and is this project's stated integration-test target — no mocking.

## Desired End State

Running `npm test` (with local Supabase either already running or auto-started) executes a Vitest suite covering: one unit test, integration tests proving the 2-meal and 3-meal collision/defer chain behavior (including an explicit assertion documenting the known traceability gap, not a silent fix), and integration tests proving the single-active-check-in invariant holds under two concurrent request scenarios with correct error translation. Running `npm run test:e2e` executes one Playwright test that triggers the same concurrency race through two real browser contexts and confirms the friendly error is visible in the DOM. `npm run typecheck` exists and passes. `context/foundation/test-plan.md` §6.1–§6.3 name this phase's conventions as the canonical answer to "how do I add a test here."

### Key Discoveries:

- `superseded_by` is write-only in this codebase — [src/lib/services/check-ins.ts:17](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/src/lib/services/check-ins.ts#L17) is the only read (as a filter), line 49 the only write. No traversal exists anywhere, so the 3-meal test must assert DB state directly rather than relying on any existing "history" API.
- `scheduleCheckIn` ([src/lib/services/check-ins.ts:29-38](https://github.com/mm987gmx/MealMirror/blob/67d6362cc378a4d07c14314345619a7dafb237a2/src/lib/services/check-ins.ts#L29-L38)) is the only INSERT that can trigger the partial unique index — every race scenario reduces to two concurrent calls that both eventually reach this function.
- `@supabase/ssr`'s `createServerClient` reads its session from a cookie whose value is `base64-` + base64url(JSON.stringify(session)), chunked by key name (`node_modules/@supabase/ssr/dist/main/cookies.js`). Reimplementing this encoding by hand is version-fragile; the same package's `createBrowserClient` already produces exactly this encoding when given fake `getAll`/`setAll` cookie accessors, so the test harness should reuse it (see Critical Implementation Details).
- Astro exposes `getViteConfig` (`node_modules/astro/dist/config/entrypoint.js`) specifically so Vitest can resolve `astro:*` virtual modules using the project's real Astro/Vite config — the standard integration point for testing an Astro codebase, not a workaround.
- `zod` is already a dependency (`package.json`) via the archived `post-meal-checkin-loop` slice's validation schemas — `CLAUDE.md`'s note that "no validation library is installed" is stale for this repo, though out of scope to fix here.

## What We're NOT Doing

- Not fixing the 3-meal traceability gap (last-meal-wins). This phase documents current behavior via a passing test and flags the gap; changing collision-resolution semantics is a product decision + separate future change, and the bug-fix-then-regression-test workflow is explicitly a later lesson's job, not this plan's.
- Not testing 4+ meal collision chains — 2 and 3 are sufficient signal for the recursive pattern per `test-plan.md` §7's explicit anti-pattern guidance.
- Not authoring or modifying `.github/workflows/ci.yml` — CI/CD pipeline configuration is reserved to a different module per this project's `CLAUDE.md`. This phase produces local `npm run test`/`test:e2e`/`typecheck` scripts ready for a later change to wire in.
- Not adding a broad e2e layer — exactly one Playwright spec, scoped to the collision/defer concurrency flow, per `test-plan.md` §4's stated scope limit.
- Not testing cross-user access (Risk #6) — that's rollout Phase 2 (`Access hardening`).
- Not adding a `status` column, changing the `check_ins` schema, or writing a new migration — this phase only adds tests against the existing schema.
- Not mocking Supabase for integration tests — all integration/e2e tests run against a real local Postgres instance via `npx supabase start`, per `test-plan.md` §4.

## Implementation Approach

Bootstrap the runner and harness first (Phases 1–2), prove the harness works with the cheapest possible test (a unit test) before writing anything DB-dependent, then layer the two risk-specific integration suites (Phases 3–4) — Risk #1 tests call the service layer directly with a signed-in `SupabaseClient` (simplest, no cookie machinery needed), while Risk #2 tests must invoke the actual API route handlers (to prove the try/catch error-translation path), which is where the cookie-simulation helper is needed. The one e2e test (Phase 5) reuses the same test-user harness through a real browser. Phase 6 closes the loop by updating the cookbook so later rollout phases don't have to rediscover these decisions.

## Critical Implementation Details

**Auth simulation for direct route-handler tests.** The route handlers build their Supabase client from a `Cookie` header (`src/lib/supabase.ts` → `@supabase/ssr`'s `createServerClient`), not a bearer token — a hand-built JWT in an `Authorization` header will not authenticate them. Build the `Cookie` header by calling `@supabase/ssr`'s `createBrowserClient` with fake `cookies: { getAll: () => [], setAll: (cookiesToSet) => { /* capture */ } }`, then `.auth.signInWithPassword(...)` on it — auth-js's real sign-in flow drives `setAll` with the exact chunked, base64url-encoded cookie entries a real browser would receive. Serialize the captured `{name, value}` pairs into a `name=value; name2=value2` string and use it as the fake `Request`'s `Cookie` header. This reuses the library's own encoding instead of reimplementing it, so it can't drift out of sync with a future `@supabase/ssr` version.

**Vitest ↔ Astro env/adapter interop is unverified — gate it with a smoke test, don't assume it.** `vitest.config.ts` should use `getViteConfig` from `astro/config` so `astro:env/server` resolves. Two things are genuinely unknown until run: (1) whether Vite's `.env.test` auto-load (triggered by Vitest's default `mode: "test"`) actually populates the values `astro:env/server` reads in this Astro/adapter combination, and (2) whether `getViteConfig` tolerates the Cloudflare adapter (`@astrojs/cloudflare`) being present in `astro.config.mjs` when running under plain Node rather than Workers. Phase 1's automated verification includes a one-line smoke test that imports `SUPABASE_URL` from `astro:env/server` and asserts it is defined, specifically to catch either failure immediately. If it fails: for (1), explicitly load env in `vitest.config.ts` via Vite's `loadEnv(mode, process.cwd(), "")` merged into `process.env` before calling `getViteConfig`; for (2), pass a second argument to `getViteConfig` overriding `adapter`/`output` for the test config only.

**The 3-meal test documents behavior, it does not bless it as a requirement.** Name the test and its assertions so a future reader understands this is a characterization of current behavior flagged as an open product question (per `research.md` Open Questions), not a spec the team decided is correct — e.g. a test name like `"documents: earlier meals in a 3+ defer chain never get a completable check-in (known gap, see research.md)"` rather than a name implying this is the intended design.

**The Supabase auto-start helper must never stop the stack.** Per the chosen automatic-`pretest` approach, `scripts/ensure-supabase-running.mjs` must check `npx supabase status` and only run `npx supabase start` if it's not already up — it must never run `supabase stop`, since that could kill a developer's already-running local instance they wanted to keep for other work.

## Phase 1: Test Tooling Bootstrap

### Overview

Add Vitest, the `typecheck` script, the Supabase auto-start helper, and the `.env.test` scaffolding — with nothing yet depending on real test content, so failures here are isolated to tooling, not test logic.

### Changes Required:

#### 1. Vitest + typecheck dependencies and scripts

**File**: `package.json`

**Intent**: Add the test runner, the e2e runner, and the scripts that drive them, following the Quality Gates decision to add `typecheck` now even though CI wiring is a later change's job.

**Contract**: devDependencies gain `vitest` (`^5.0.0`, checked 2026-09-13) and `@playwright/test` (`^1.63.0`, checked 2026-09-13). Scripts gain: `"test": "vitest run"`, `"test:watch": "vitest"`, `"test:e2e": "playwright test"`, `"typecheck": "astro check"`, `"pretest": "node scripts/ensure-supabase-running.mjs"`, `"pretest:e2e": "node scripts/ensure-supabase-running.mjs"`. Do not add a `test` entry to `lint-staged` — these are whole-suite runs, not per-file hooks.

#### 2. Vitest configuration

**File**: `vitest.config.ts` (new)

**Intent**: Make `astro:env/server` and the project's other Astro virtual modules resolvable inside Vitest by reusing Astro's real Vite config, per the officially exposed `getViteConfig` integration point.

**Contract**: `export default getViteConfig({ test: { environment: "node", include: ["src/**/*.test.ts"] } })` from `astro/config`. See Critical Implementation Details for the env-loading and adapter-interop fallback if the Phase 1 smoke test fails.

#### 3. Supabase auto-start helper

**File**: `scripts/ensure-supabase-running.mjs` (new)

**Intent**: Let `npm test`/`npm run test:e2e` start local Supabase automatically when it isn't already running, without ever stopping an already-running instance.

**Contract**: A Node script with no dependencies beyond `child_process`: run `npx supabase status`; on non-zero exit, run `npx supabase start` with inherited stdio; on zero exit, do nothing and exit 0. Never invoke `supabase stop`.

#### 4. Test environment scaffolding

**File**: `.env.test.example` (new), `.gitignore` (edit)

**Intent**: Give the test suite its own env file, following this repo's existing `.env.example`/`.dev.vars.example` placeholder convention, and keep the real one out of version control.

**Contract**: `.env.test.example` declares `SUPABASE_URL=###`, `SUPABASE_KEY=###`, `SUPABASE_SERVICE_ROLE_KEY=###` (the third is test-only — read via plain `process.env` in test-support code, never through the app's `astro:env/server` schema, which doesn't declare it). `.gitignore` gains `.env.test`, `playwright-report/`, `test-results/`, `blob-report/`.

#### 5. Env-loading smoke test

**File**: `src/lib/test-support/env-smoke.test.ts` (new)

**Intent**: Fail fast and specifically if `.env.test` isn't reaching `astro:env/server` under Vitest, rather than surfacing as a confusing failure two phases later.

**Contract**: Imports `SUPABASE_URL`, `SUPABASE_KEY` from `astro:env/server`; asserts both are truthy strings.

### Success Criteria:

#### Automated Verification:

- `npm install` completes with `vitest` and `@playwright/test` present in `package.json`
- `npx vitest run` executes (even with only the smoke test present) and exits 0
- `npm run typecheck` passes
- The env-loading smoke test (`src/lib/test-support/env-smoke.test.ts`) passes, confirming `.env.test` values reach `astro:env/server` under Vitest

#### Manual Verification:

- With local Supabase stopped, run `npm test` once and confirm it starts automatically; run it a second time with Supabase already running and confirm the script does not attempt to stop or restart it

---

## Phase 2: Test Harness Helpers

### Overview

Build the two auth-related helpers every later test in this phase depends on, and prove each works with the smallest possible test before building on top of it.

### Changes Required:

#### 1. Throwaway test-user admin client

**File**: `src/lib/test-support/supabase-test-client.ts` (new)

**Intent**: Give tests a way to create and tear down a real, isolated Supabase Auth user per test case, per the "fresh throwaway user per test" isolation decision.

**Contract**: Exports `createAdminClient()` (plain `@supabase/supabase-js` client using `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from `process.env`), `createTestUser(admin)` returning `{ id, email, password }` via `admin.auth.admin.createUser({ email_confirm: true, ... })` with a randomly generated email/password, and `deleteTestUser(admin, userId)` via `admin.auth.admin.deleteUser`. Also exports `signInTestUser(email, password)` returning a plain, request-authenticated `SupabaseClient` via `createClient(url, anonKey).auth.signInWithPassword(...)` — used directly by Phase 3's service-layer tests, which take a `SupabaseClient` as a parameter and need no cookie machinery.

#### 2. Route-handler auth + fake APIContext helper

**File**: `src/lib/test-support/api-context.ts` (new)

**Intent**: Let Phase 4's tests invoke the real exported route handlers, per the "call the exported handler directly" decision, satisfying their internal cookie-based `createClient` call.

**Contract**: Exports `buildSessionCookieHeader(email, password)` implementing the technique described in Critical Implementation Details, and `buildFakeApiContext({ request, userId })` returning an object with exactly the properties `src/pages/api/meals.ts` and `src/pages/api/check-ins/collision.ts` read: `request`, `locals: { user: { id: userId } }`, `cookies: { set: () => {} }` (no-op — the route only writes refreshed session cookies, which these tests don't assert on), and `redirect(url) => new Response(null, { status: 302, headers: { Location: url } })`.

### Success Criteria:

#### Automated Verification:

- Unit test `src/lib/services/postgres-errors.test.ts` passes, asserting `isUniqueViolation` returns `true` for `{ code: "23505" }` and `false` for other shapes (including `undefined`/non-object input)
- Smoke test in `src/lib/test-support/supabase-test-client.test.ts` creates a throwaway user, confirms it exists via the admin client, deletes it, and confirms it's gone
- Smoke test in `src/lib/test-support/api-context.test.ts` signs in a throwaway user, builds the cookie header, constructs a real Supabase server client (`@supabase/ssr`'s `createServerClient`) reading that header, and confirms `supabase.auth.getUser()` returns the same user id — proving the cookie round-trip actually authenticates

#### Manual Verification:

- After running the suite once, check Supabase Studio's Auth → Users list to confirm no throwaway users remain (teardown ran cleanly even on the smoke tests)

---

## Phase 3: Risk #1 — Collision/Defer Chain Coverage

### Overview

Prove the 2-meal cases (regression baseline for already-shipped, manually-verified behavior) and the 3-meal defer chain (the actual target of Risk #1), asserting DB state directly since nothing in the codebase reads the chain back.

### Changes Required:

#### 1. Collision/defer chain integration tests

**File**: `src/lib/services/meals.test.ts` (new)

**Intent**: Characterize `createMealWithCheckIn`/`resolveCollision`'s behavior across 1, 2, and 3 sequential meals against a real database, for a single throwaway test user per test case.

**Contract**: Each test creates its own user via Phase 2's helper, gets a signed-in `SupabaseClient`, and asserts on the raw `check_ins`/`meals` rows (via `supabase.from(...).select()`), not on the service functions' return values alone. Four cases:
- One meal, no prior check-in → `collision` is `null`; exactly one check-in row exists, active, `meal_id` = the meal.
- Two meals, "keep" → exactly one active check-in (the original, untouched); the second meal has zero associated check-in rows.
- Two meals, "defer" → the original check-in's `superseded_by` equals the new check-in's id; the new check-in is the sole active row and its `meal_id` is the second meal.
- Three meals, defer→defer → exactly one active check-in (tied to the third meal); `checkin1.superseded_by === checkin2.id` and `checkin2.superseded_by === checkin3.id`; `checkin1` and `checkin2` both have `completed_at === null` and are excluded from `findActiveCheckIn`, i.e. permanently non-completable under current code — asserted as the documented known gap per Critical Implementation Details, not silently treated as correct-by-design.

### Success Criteria:

#### Automated Verification:

- All four cases in `src/lib/services/meals.test.ts` pass against local Supabase
- `npm run typecheck` and `npm run lint` still pass with the new file present

#### Manual Verification:

- Spot-check one of the four cases' resulting rows directly in Supabase Studio (matching this project's existing manual-verification pattern from the archived `post-meal-checkin-loop` plan) to confirm the test's assertions match what's actually in the table, not just what the test claims

---

## Phase 4: Risk #2 — Single-Active-Check-In Invariant Coverage

### Overview

Prove no concurrent request pair can produce two active check-ins for one user, and that the resulting Postgres error is correctly translated into the documented friendly message — by invoking the real route handlers, not just the service layer.

### Changes Required:

#### 1. Concurrent meal-creation race test

**File**: `src/pages/api/meals.test.ts` (new)

**Intent**: Prove the race identified in the archived impl-review (finding F2) stays closed: two near-simultaneous meal submissions for a user with no pre-existing collision must not both succeed in creating an active check-in.

**Contract**: One throwaway user; build two fake `APIContext`s sharing that user's session cookie, each with its own meal `FormData`; `await Promise.all([POST(context1), POST(context2)])`; assert exactly one response redirects to `/dashboard` (no `error` param) and the other's `Location` header contains the exact friendly message from `src/pages/api/meals.ts:35` (`"Your pending check-in changed while you were logging this meal — please try again."`); assert the DB has exactly one active check-in for that user afterward.

#### 2. Concurrent defer race test

**File**: `src/pages/api/check-ins/collision.test.ts` (new)

**Intent**: Prove the F1 race (two concurrent "defer" submissions against the same pending check-in) stays closed.

**Contract**: One throwaway user with an existing pending check-in (via the Phase 3 pattern: log meal 1, then meal 2 to create a collision); build two fake `APIContext`s both submitting `action: "defer"` against the same `pendingCheckInId`/`mealId`; assert exactly one succeeds (redirects to `/dashboard` with no error) and the other's `Location` contains the exact message from `src/pages/api/check-ins/collision.ts:33` (`"This check-in was already resolved elsewhere — please refresh and try again."`); assert exactly one active check-in exists afterward.

#### 3. Sequential happy-path regression test

**File**: `src/pages/api/check-ins/collision.test.ts` (same file, additional case)

**Intent**: Confirm the non-race path still works via the same handler-invocation harness, so the race tests aren't the only thing exercising this route.

**Contract**: A single sequential "defer" call against a real pending collision succeeds with a plain `/dashboard` redirect and no error param.

### Success Criteria:

#### Automated Verification:

- Both race tests and the sequential regression test pass against local Supabase
- Re-running the race tests 3 times in a row (`npx vitest run --repeat=3` or a loop) passes every time — a single green run isn't sufficient evidence for a concurrency test
- `npm run typecheck` and `npm run lint` pass

#### Manual Verification:

- Spot-check the DB state after one race-test run directly in Supabase Studio to confirm exactly one active check-in row and one superseded/absent row, matching the test's assertions

---

## Phase 5: E2E Scoped Check

### Overview

One Playwright test, scoped only to the collision/defer concurrency flow, proving the friendly error is actually visible in a real browser — not just present in a redirect URL.

### Changes Required:

#### 1. Playwright bootstrap

**File**: `playwright.config.ts` (new)

**Intent**: Configure Playwright to launch the real Astro dev server against local Supabase for this one flow.

**Contract**: `testDir: "./e2e"`, `webServer: { command: "npm run dev", url: "http://localhost:4321", reuseExistingServer: !process.env.CI, env: { SUPABASE_URL: ..., SUPABASE_KEY: ... } }` sourced from `.env.test`. One project (Chromium) is sufficient for this scoped check — no cross-browser matrix.

#### 2. Collision-race e2e spec

**File**: `e2e/collision-race.spec.ts` (new)

**Intent**: Reproduce the same concurrency scenario as Phase 4's defer-race test, but end-to-end through two real browser contexts signed in as the same user, to prove the error is visible in the DOM.

**Contract**: Use Phase 2's test-user helper to create one throwaway user and sign in twice, once per Playwright `browser.newContext()`, each restoring the session via `context.addCookies(...)` built from Phase 2's cookie helper (reused here, not reimplemented) so both browser tabs are authenticated as the same user without going through the UI login form. Log meal 1 and meal 2 via the UI in one tab to create a pending collision, then submit "defer" from both tabs at effectively the same time (`Promise.all` on both tabs' form-submit actions); assert one tab lands on a clean dashboard and the other's dashboard shows the visible red error text matching `src/pages/api/check-ins/collision.ts:33`'s message.

### Success Criteria:

#### Automated Verification:

- `npm run test:e2e` passes the one spec

#### Manual Verification:

- Run `npx playwright test --headed` once to visually confirm the error banner renders legibly, not just that the DOM contains the text

---

## Phase 6: Cookbook Update

### Overview

Record this phase's conventions in `context/foundation/test-plan.md` §6 so future rollout phases (and anyone adding a test to this project) don't have to rediscover them.

### Changes Required:

#### 1. Cookbook sections

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the `TBD` placeholders in §6.1–§6.3 with this phase's actual conventions, and update the §3 Phase 1 row's Status.

**Contract**: §6.1 (unit test) names `src/lib/services/postgres-errors.test.ts` as the reference, co-located naming (`*.test.ts` next to the file it tests), run via `npm test`. §6.2 (integration test) names `src/lib/services/meals.test.ts` and `src/pages/api/meals.test.ts` as references, documents the throwaway-user-per-test pattern and the two auth helpers from `src/lib/test-support/`, and the `npx supabase start` prerequisite (auto-started by `pretest`). §6.3 (e2e test) names `e2e/collision-race.spec.ts`, notes e2e is deliberately scoped to this one flow, run via `npm run test:e2e`. §3's Phase 1 row Status updates to `implementing` (this plan will move it to `complete` once `/10x-implement` finishes all phases and their manual verifications land).

### Success Criteria:

#### Automated Verification:

- `npm run lint` / `npm run format` pass on the updated `test-plan.md` (prettier formats `.md` via `lint-staged`)

#### Manual Verification:

- Read §6.1–§6.3 back and confirm each names an actual location, naming convention, reference test, and run command that matches what Phases 1–5 actually built

---

## Testing Strategy

### Unit Tests:

- `isUniqueViolation` (`src/lib/services/postgres-errors.ts`) — the one pure function in this phase's scope, and the first thing the new runner proves works.

### Integration Tests:

- Collision/defer chain at 1, 2, and 3 meals (service-layer, Risk #1).
- Concurrent meal-creation and concurrent-defer races (route-layer, Risk #2), plus one sequential regression case.
- All integration tests run against real local Postgres via `npx supabase start` (auto-started), using a fresh throwaway Supabase Auth user per test case, torn down afterward.

### Manual Testing Steps:

1. Stop local Supabase, run `npm test`, confirm it auto-starts; run it again already-running, confirm it isn't stopped/restarted.
2. Spot-check the 3-meal chain test's resulting rows in Supabase Studio.
3. Spot-check one race test's resulting rows in Supabase Studio.
4. Run the e2e spec with `--headed` once to visually confirm the error banner.
5. Confirm no throwaway test users remain in Supabase Studio's Auth → Users after a full suite run.

## Performance Considerations

Each integration test's admin create/delete round-trip adds roughly 200-500ms of Supabase Auth API overhead; at this phase's test count (roughly a dozen cases) total suite time is expected to stay in the low tens of seconds. This phase does not attempt load/performance testing — out of scope per `test-plan.md` §7.

## Migration Notes

No database schema changes. New local-only artifacts: `.env.test` (gitignored), `scripts/ensure-supabase-running.mjs`, `src/lib/test-support/`, `e2e/`. No changes to `.github/workflows/ci.yml` — CI wiring for these new scripts is a separate, later change.

## References

- Research: `context/changes/testing-collision-invariant-coverage/research.md`
- Test plan: `context/foundation/test-plan.md` (§2 Risk #1/#2, §3 Phase 1, Risk Response Guidance)
- Prior fix this phase verifies: commit `20cc899` (partial unique index + error translation)
- Archived design intent: `context/archive/2026-09-12-post-meal-checkin-loop/plan.md:28` (the unverified 3-meal assumption)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Test Tooling Bootstrap

#### Automated

- [x] 1.1 `npm install` completes with vitest and @playwright/test present — a4809c3
- [x] 1.2 `npx vitest run` executes and exits 0 — a4809c3
- [x] 1.3 `npm run typecheck` passes — a4809c3
- [x] 1.4 Env-loading smoke test passes — a4809c3

#### Manual

- [x] 1.5 Auto-start works when stopped; doesn't restart when already running — a4809c3

### Phase 2: Test Harness Helpers

#### Automated

- [x] 2.1 `isUniqueViolation` unit test passes — b332945
- [x] 2.2 Throwaway-user create/delete smoke test passes — b332945
- [x] 2.3 Cookie/APIContext round-trip smoke test passes — b332945

#### Manual

- [x] 2.4 No throwaway users remain in Supabase Studio after suite run — b332945

### Phase 3: Risk #1 — Collision/Defer Chain Coverage

#### Automated

- [x] 3.1 One-meal, two-meal keep, two-meal defer, and three-meal defer-chain cases all pass — 5f75677
- [x] 3.2 `npm run typecheck` and `npm run lint` pass — 5f75677

#### Manual

- [x] 3.3 Spot-check one case's DB rows in Supabase Studio — 5f75677

### Phase 4: Risk #2 — Single-Active-Check-In Invariant Coverage

#### Automated

- [x] 4.1 Concurrent meal-creation race test passes — ad068c1
- [x] 4.2 Concurrent defer race test passes — ad068c1
- [x] 4.3 Sequential happy-path regression test passes — ad068c1
- [x] 4.4 Race tests pass on 3 repeated runs — ad068c1
- [x] 4.5 `npm run typecheck` and `npm run lint` pass — ad068c1

#### Manual

- [x] 4.6 Spot-check race-test DB state in Supabase Studio — ad068c1

### Phase 5: E2E Scoped Check

#### Automated

- [x] 5.1 `npm run test:e2e` passes

#### Manual

- [x] 5.2 Headed run visually confirms the error banner

### Phase 6: Cookbook Update

#### Automated

- [ ] 6.1 `npm run lint`/`npm run format` pass on updated test-plan.md

#### Manual

- [ ] 6.2 §6.1–§6.3 read back and confirmed accurate
