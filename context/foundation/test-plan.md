# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-09-12

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression. This project's owner has an explicit low tolerance for
   redundant coverage — each risk is covered once, at its cheapest
   sufficient layer, never re-verified across multiple layers "just in
   case."
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X" carry the same weight as PRD lines or hot-spot
   data. The owner flagged multi-meal collision handling unprompted, twice,
   independent of the interview questions asked — that repetition is
   itself signal.
3. **Risks are scenarios, not code locations.** This plan documents _what
   could fail_ and _why we believe it's likely_ — drawn from documents,
   interview, and codebase _signal_ (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/migrations/`
(8 commits / 30d — the project's entire history to date, one intensive
build window; sufficient signal per the insufficient-history guard).

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the _evidence that
surfaced this risk_ — never a specific file as "where the failure lives."

| #   | Risk (failure scenario)                                                                                                                                                            | Impact      | Likelihood                           | Source (evidence — not anchor)                                                                                                                                                                                                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A third (or later) meal logged while an earlier deferred check-in is still pending corrupts the active-check-in chain, losing traceability between a specific meal and its symptom | High        | Medium-High                          | interview Q1, interview Q3 (raised independently, twice); PRD Business Logic; archived slice `post-meal-checkin-loop` plan (states the 2-meal case as designed, N-meal case as an unverified assumption); hot-spot dirs `src/lib/services`, `src/pages/api` |
| 2   | The "one active check-in per user" invariant is violated under near-simultaneous requests, producing duplicate active check-ins                                                    | High        | Medium                               | recent fix commit explicitly titled "enforce single-active-check-in invariant + defense-in-depth scoping" — signals this class of bug has already occurred once                                                                                             |
| 3   | Quiet-hours suppression mishandles boundary/wraparound windows (e.g. 23:00–07:00), silently dropping or wrongly queuing a post-meal check-in                                       | Medium-High | Medium                               | PRD Business Logic (quiet hours); roadmap S-04 (`quiet-hours-config`, proposed)                                                                                                                                                                             |
| 4   | Fixed morning/evening check-ins duplicate on repeated same-day logins, or misalign across a multi-day gap, corrupting the day-bucket                                               | Medium-High | Medium                               | roadmap S-02 (`fixed-daily-checkins`, change opened, no research/plan yet); PRD FR-005, FR-006                                                                                                                                                              |
| 5   | CSV/JSON export silently duplicates or drops records tied to a superseded/deferred check-in, misrepresenting the user's timeline to a doctor                                       | High        | Low-Medium                           | PRD NFR (export must be "usable in a spreadsheet or shareable with a doctor or dietitian"); roadmap S-05 (proposed); dependency on Risk #1                                                                                                                  |
| 6   | [Abuse] A user's session can read, complete, or defer another user's meal or check-in because an app-layer bug bypasses RLS-level scoping                                          | High        | Low today / High after v2 multi-user | PRD Access Control + NFR (health-data privacy); roadmap baseline note ("architecture must not assume single-user globally"); archived slice plan (explicit note that `user_id` scoping on writes is manual discipline, not structurally guaranteed)         |

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                                                                     | Must challenge                                                                                                                                                 | Context `/10x-research` must ground                                                                                                                                     | Likely cheapest layer                                                        | Anti-pattern to avoid                                                                                                                    |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| #1   | Logging a 3rd meal while an earlier deferred check-in is still pending yields exactly one active check-in, and the `superseded_by`-style chain can be traced back through every superseded meal | "the 2-meal collision test passing proves the N-meal case" — recursion isn't proven by its base case                                                           | exact chain semantics on repeated defer; whether "keep" behaves identically on a 3rd collision as on the 2nd; ordering guarantees for near-simultaneous meal inserts    | integration test against the service layer (no UI needed)                    | asserting against whatever the current implementation returns for meal 3 instead of against the PRD's stated single-active-check-in rule |
| #2   | No code path can create two simultaneously active check-ins for one user, including under a request race                                                                                        | "the DB constraint alone guarantees this" — the app layer may swallow the resulting error and show a silently wrong state                                      | how a constraint violation on concurrent creation is translated into an API/user-facing error, and whether the UI surfaces it or fails silently                         | integration/DB-level test on the constraint + the error-translation path     | testing only the sequential happy-path insert, never the concurrent one                                                                  |
| #3   | A check-in due inside the quiet-hours window is suppressed before queuing; one just outside the window queues normally; morning/evening check-ins queue regardless                              | "quiet hours is a UI display filter" — PRD requires suppression before queuing, not hiding on the client                                                       | whether suppression happens at creation time or due-time evaluation; how the window is stored (wraparound handling for windows crossing midnight); timezone assumptions | unit test on the pure suppression-decision function                          | testing only an easy in-window and easy out-of-window time, skipping the exact boundary and the midnight wraparound                      |
| #4   | Exactly one morning and one evening check-in exists per calendar day per user; repeated same-day logins don't duplicate; a multi-day gap doesn't misassign days                                 | "the 90-minute post-meal engine generalizes to fixed times" — fixed check-ins are calendar-day bound, not duration-triggered                                   | how "morning"/"evening" are defined; what determines day ownership; behavior after multiple missed days                                                                 | unit/integration test on the day-bucketing logic                             | testing only the single-day happy path, never a multi-day gap or same-day repeat login                                                   |
| #5   | Exporting a period containing superseded/deferred check-ins produces a record set a doctor could correctly reconstruct — consistent inclusion/exclusion, never silent duplication or loss       | "export is just a SELECT \* dump" — how history is represented is a product decision, not an accident of query shape                                           | whether superseded/incomplete check-ins belong in the export at all; the exact CSV/JSON shape required                                                                  | unit/contract test against a fixture with known collision/defer history      | snapshotting the current export output as "expected" (oracle problem)                                                                    |
| #6   | A session for user A cannot read, complete, or defer any resource belonging to user B, even with a guessed/known ID                                                                             | "RLS alone protects us, app-layer tests are redundant" — a bug bypassing RLS (e.g. an elevated client, or an unfiltered query) is only caught from the outside | which code paths use the user-scoped client vs. any elevated client; whether any endpoint trusts a client-supplied resource ID without an ownership check               | integration test hitting API routes with two distinct authenticated sessions | testing only "logged-out user is redirected," never "logged-in-as-B touches A's data"                                                    |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| #   | Phase name                                                   | Goal (one line)                                                                                                  | Risks covered | Test types                                 | Status      | Change folder                                           |
| --- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------ | ----------- | ------------------------------------------------------- |
| 1   | Critical-path collision & invariant coverage                 | Prove the collision/defer chain and single-active-check-in invariant hold under 3+ meals and concurrent requests | #1, #2        | unit + integration (bootstraps the runner) | complete    | `context/changes/testing-collision-invariant-coverage/` |
| 2   | Access hardening                                             | Prove no session can touch another user's health data                                                            | #6            | integration                                | not started | —                                                       |
| 3   | New-feature guardrails (quiet hours + fixed daily check-ins) | Prove quiet-hours boundary handling and daily-check-in bucketing as S-04/S-02 land                               | #3, #4        | unit + integration                         | not started | —                                                       |
| 4   | Export correctness                                           | Prove exported data faithfully reconstructs the collision/defer history                                          | #5            | contract                                   | not started | —                                                       |

**Status vocabulary** (fixed — parser literals): `not started` → `change opened` → `researched` → `planned` → `implementing` → `complete`.

AI-native layer deliberately excluded as a dedicated phase — see §4 and §7.

## 4. Stack

The classic test base for this project. No test runner exists yet (Phase 1
bootstraps it). Recommendations below are grounded in the local manifest
(Astro 7, Vite-based tooling) plus the MCP/tools actually exposed in the
current session — no docs/search MCP was available, so nothing below rests
on an unverified external claim.

| Layer                | Tool                                                             | Version                | Notes                                                                                                                                            |
| -------------------- | ---------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| unit + integration   | Vitest                                                           | none yet — see Phase 1 | Astro 7 runs on Vite; Vitest is the natural fit with no extra bundler config                                                                     |
| API mocking          | none yet — see Phase 1                                           | —                      | integration tests hit a local Supabase instance directly (`npx supabase start`), not mocks, per the archived slices' own DB-verification pattern |
| e2e                  | none yet — see Phase 5 quality gates                             | —                      | scoped only to the collision/defer critical flow if added; not justified broadly at this project's scale                                         |
| accessibility        | none                                                             | —                      | not raised by PRD, roadmap, or interview; out of scope for this rollout                                                                          |
| (optional) AI-native | multimodal visual review — not selected as a tool, category only | n/a                    | see §5; selective use only on the dashboard collision card, never as a substitute for the integration tests in Phase 1                           |

**Stack grounding tools (current session):**

- Docs: none available in current session (no Context7/framework-docs MCP exposed); checked: 2026-09-12
- Search: no dedicated search MCP exposed this session; checked: 2026-09-12
- Runtime/browser: no Playwright/browser MCP exposed this session; checked: 2026-09-12
- Provider/platform: GitHub via authenticated `gh` CLI (`repo`, `workflow` scopes) — relevant once §5's CI gates are wired; checked: 2026-09-12

## 5. Quality Gates

| Gate                     | Where                | Required?                                                          | Catches                                                                                        |
| ------------------------ | -------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| lint                     | local + CI           | required (already wired — `.github/workflows/ci.yml`)              | syntactic / style drift                                                                        |
| typecheck                | local + CI           | required after §3 Phase 1                                          | type drift (currently not a separate CI step — `astro build` alone does not run `astro check`) |
| unit + integration       | local + CI           | required after §3 Phase 1                                          | logic regressions in collision/invariant/access logic                                          |
| e2e on critical flows    | CI on PR             | required after §3 Phase 1, scoped to the collision/defer flow only | a broken north-star flow reaching production                                                   |
| post-edit hook           | local (agent loop)   | recommended (configuration is Module 3 Lesson 3's job)             | regressions at edit time                                                                       |
| multimodal visual review | CI on PR             | optional, selective — dashboard collision card only                | visual issues a classic diff misses                                                            |
| pre-prod smoke           | between merge + prod | optional                                                           | Cloudflare Workers environment-specific failures                                               |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section fills in once the
relevant rollout phase ships; before that it reads "TBD — see §3 Phase N."

### 6.1 Adding a unit test

Co-locate the test next to the file it tests: `<name>.test.ts` beside `<name>.ts` — e.g. `src/lib/services/postgres-errors.test.ts` next to `postgres-errors.ts`. Import `describe`/`expect`/`it` from `vitest`. No mocking framework is configured — for a pure function, call it directly with representative inputs, including edge/malformed shapes. Run via `npm test` (or `npm run test:watch` while iterating).

### 6.2 Adding an integration test

Co-locate next to the code under test, same `<name>.test.ts` convention — e.g. `src/lib/services/meals.test.ts` (service-layer) and `src/pages/api/meals.test.ts` (route-layer). Two auth patterns depending on what you're testing:

- **Testing a service function directly** (it takes a `SupabaseClient` parameter): sign in a throwaway user via `signInTestUser` (`src/lib/test-support/supabase-test-client.ts`) and call the function with the resulting client.
- **Testing an API route handler directly** (needs a real request/cookie, not just a client): build a session cookie via `buildSessionCookieHeader` and a fake `APIContext` via `buildFakeApiContext` (`src/lib/test-support/api-context.ts`), then call the exported `POST`/`GET` handler directly, casting the fake context `as unknown as APIContext`.

Every test creates its own throwaway Supabase Auth user via `createAdminClient`/`createTestUser` and tears it down in a `finally` block via `deleteTestUser` — never share a user across tests; this matters most for concurrency tests, where shared state would pollute the very invariant under test. Tests run against a real local Postgres instance, no mocking; `npx supabase start` is a prerequisite, auto-started by the `pretest` npm hook (`scripts/ensure-supabase-running.mjs`) if not already running (it never stops an already-running instance). For a genuine concurrency test, fire the calls via `Promise.all`/`Promise.allSettled` and re-run a few times in the same test run — a single green pass isn't sufficient evidence. Run via `npm test`.

### 6.3 Adding an e2e test

e2e is deliberately scoped — add a spec only when a risk genuinely needs a full browser (e.g. proving something is _visible in the DOM_, not just present in a redirect URL or response body). One test per file under `e2e/`, e.g. `e2e/collision-race.spec.ts`. Reuse `buildSessionCookies` (`src/lib/test-support/api-context.ts`) with `BrowserContext.addCookies` to authenticate without going through the UI login form. Note: `playwright.config.ts`'s `webServer` runs `npm run build && npx wrangler dev`, not `npm run dev` — `astro dev`'s Cloudflare Workers dev-mode integration currently crashes in this environment with an unrelated astro/`@astrojs/cloudflare`/workerd version-skew bug; revisit once that's fixed, since the current setup means the e2e suite exercises a built snapshot, not live-reloading dev. Run via `npm run test:e2e` (add `--headed` to watch it visually).

### 6.4 Adding a test for a new API endpoint

- TBD — see §3 Phase 2 (access-hardening phase establishes the two-session integration pattern for API routes).

### 6.5 Adding a contract test for export output

- TBD — see §3 Phase 4.

### 6.6 Per-rollout-phase notes

(Empty — fills in as each phase's plan lands its final sub-phase.)

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **Redundant cross-layer verification** — each risk in §2 is covered once, at its cheapest sufficient layer (§2 Risk Response Guidance). Re-verifying the same behavior at a second or third layer "for safety" is explicitly out of scope. Re-evaluate only if a specific risk proves to need defense-in-depth after a real production incident. (Source: Phase 2 interview Q5.)
- **A dedicated AI-native test layer** — at this project's solo-MVP scale, no risk in §2 justified the cost of an AI-native layer beyond the single selective visual-review gate in §5. Re-evaluate if the product grows past single-user MVP scope. (Source: Phase 2 interview Q5; §1 cost × signal.)
- **Deep enumeration of 4+, 5+, ... meal collisions** — Phase 1 tests the 2-meal and 3-meal cases as sufficient signal for the recursive pattern; exhaustively testing every N is treated as the redundant coverage Q5 explicitly ruled out.
- **Generated types (`src/database.types.ts`)** — the Supabase codegen step is the test; asserting its output would just re-test the generator.
- **Performance/load testing** — PRD `target_scale` is low-qps/small-data-volume; not a risk this product currently has.

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-09-12
- Stack versions last verified: 2026-09-12
- AI-native tool references last verified: 2026-09-12 (none in active use — category noted only)

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
