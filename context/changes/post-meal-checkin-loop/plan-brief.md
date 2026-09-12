# Post-Meal Check-in Loop — Plan Brief

> Full plan: `context/changes/post-meal-checkin-loop/plan.md`

## What & Why

Implement MealMirror's North Star: log a meal, get a post-meal check-in scheduled 90 minutes later, see it in a pending queue once due, and complete it with a binary symptom tick — proving the product's core hypothesis that timing-triggered check-ins actually get answered.

## Starting Point

The database schema (F-01) already exists — `meals` and `check_ins` tables, RLS-scoped, with `superseded_by` for the defer chain. Auth and route protection exist. `/dashboard` is currently a static welcome page with no client islands and no domain logic. No validation library, no service layer, and no API routes for meals/check-ins exist yet.

## Desired End State

From `/dashboard`, the user logs a meal, sees it scheduled, sees due check-ins in a queue, completes them, and — if a second meal collides with an unresolved check-in — is shown an immediate keep/defer choice before anything else.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
|---|---|---|
| Validation | Add Zod now | Multiple non-trivial payloads (dates, 6 booleans) justify the dependency now rather than repeating manual checks across S-02..S-05. |
| Route pattern | Native `<form>` POST + redirect | Matches the only existing precedent (`SignInForm`/`signin.ts`) exactly — no new client-fetch pattern to introduce. |
| Pending queue filter | Only `due_at <= now()` | Matches US-01's "visible in the queue" framing; upcoming-but-not-due check-ins aren't shown. |
| Collision UX | Immediate decision after 2nd meal's submit | Matches the PRD's Business Logic verbatim ("the user is asked") rather than a silent default. |
| Page location | Everything on `/dashboard` | Matches "on next login" framing from US-01; avoids extra protected routes for this slice. |
| Testing | Manual-only, no test runner | Consistent with F-01's precedent; keeps this slice shippable in the available time. |
| Error display | Redirect with `?error=` | Reuses the existing `ServerError` component and `signin.ts` pattern exactly. |

## Scope

**In scope:** meal logging form, 90-minute check-in scheduling, due-check-ins queue, check-in completion (6 symptoms), meal-collision keep/defer decision.

**Out of scope:** morning/evening check-ins (S-02), timeline (S-03), quiet hours (S-04), export (S-05), automated tests, new shadcn components, fetch/JSON API, dedicated non-dashboard pages.

## Architecture / Approach

Three layers, each independently verifiable: a pure service layer (`src/lib/services/`) holding the collision/defer business rule behind Zod-validated input; thin `APIRoute` handlers that parse `FormData` and redirect; and dashboard UI composed of one new React island (`MealForm`, for the meal-logging form) plus plain server-rendered Astro forms for check-in completion and the collision decision (no React needed there — they're simple POST-and-redirect actions).

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Validation + service layer | Zod schemas + `src/lib/services/{meals,check-ins}.ts` implementing scheduling, collision detection, defer, completion | Collision predicate (`completed_at is null AND superseded_by is null`) must be exactly right — it's the crux of the whole slice |
| 2. API routes + middleware | 3 new `APIRoute`s wired to the service layer; `PROTECTED_ROUTES` extended | Forgetting the middleware registration would leave mutation routes unauthenticated |
| 3. Dashboard UI | `MealForm` island + queue + collision-decision card on `/dashboard` | Collision UI must fully block the rest of the dashboard until resolved, per the immediate-decision choice |

**Prerequisites:** F-01 (archived, done) — schema already in place.
**Estimated effort:** ~2-3 sessions across 3 phases.

## Open Risks & Assumptions

- `due_at` is computed from submission time (`now() + 90m`), not the user-entered `occurred_at` — this reading of the PRD's Business Logic ("90 minutes after a meal is logged") is not explicitly re-confirmed with the user in this planning session, though it matches the PRD text closely.
- Testing the 90-minute window requires manually back-dating `due_at` via Supabase Studio — no automated way to fast-forward time in this manual-only testing approach.

## Success Criteria (Summary)

- A meal can be logged and a check-in appears in the queue once its `due_at` has passed.
- Completing a check-in records all 6 symptom values and disappears from the queue.
- A colliding second meal triggers an immediate keep/defer decision, and both branches produce the correct `superseded_by` state.
