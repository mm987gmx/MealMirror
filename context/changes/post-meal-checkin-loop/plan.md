# Post-Meal Check-in Loop Implementation Plan

## Overview

Implement MealMirror's north-star flow: log a meal, have the system schedule a post-meal check-in 90 minutes later, surface it in a pending-check-ins queue once due, and let the user complete it with a binary tick per symptom — including the same-window meal-collision defer choice from the PRD's Business Logic.

## Current State Analysis

- Database foundation (F-01, archived) already provides `public.meals` and `public.check_ins`, RLS-scoped to `auth.uid() = user_id`, with `check_ins.superseded_by` self-referencing for the defer chain and `check_ins.completed_at` (null = pending) for lifecycle. Types are generated at `src/database.types.ts`, re-exported as `Meal`/`CheckIn`/`CheckInKind` from `src/types.ts`.
- Auth is fully wired (`src/lib/supabase.ts`, `src/middleware.ts`) but `src/middleware.ts:4`'s `PROTECTED_ROUTES = ["/dashboard"]` only guards page routes by path prefix — new API routes under `/api/meals` and `/api/check-ins` are NOT covered and need explicit registration.
- `src/pages/dashboard.astro` is currently server-only Astro (no client islands) — just a welcome message and a sign-out form.
- The only existing form pattern is `src/pages/auth/signin.astro` → `SignInForm.tsx` (React island, `client:load`) posting via native `<form method="POST" action="...">` to an `APIRoute` that reads `FormData`, casts fields `as string`, and returns `context.redirect(...)` — success goes to `/`, failure goes back to the form with `?error=<message>` (rendered via `ServerError.tsx`). `FormField.tsx`, `PasswordToggle.tsx`, `SubmitButton.tsx`, `ServerError.tsx` in `src/components/auth/` are generic Tailwind+lucide components with no auth-specific logic — safe to import into a new `src/components/meals/` form.
- No validation library is installed; `zod` is not a dependency (CLAUDE.md is explicit that one must be added before assuming schemas exist).
- No `src/lib/services/` directory exists yet — this plan creates it.

## Desired End State

From `/dashboard`, the user can: submit a meal (date/time + free-text description) via a React-island form; see it immediately reflected as a scheduled check-in; see a queue of check-ins whose `due_at` has arrived, each completable with a 6-symptom tick form; and, if a second meal is logged while an earlier post-meal check-in is still unresolved, be shown an immediate keep/defer decision before anything else on the dashboard.

Verified by: `npm run lint` and `npm run build` pass; manually logging a meal creates a `meals` row and a `check_ins` row due ~90 minutes later; manually back-dating a check-in's `due_at` via Supabase Studio makes it appear in the dashboard queue; completing it sets `completed_at` and the ticked symptom columns; logging a second meal while the first's check-in is still pending (not yet completed, `superseded_by is null`) shows the collision decision, and choosing "defer" creates a new check-in for the second meal and sets `superseded_by` on the first.

### Key Discoveries:

- **`due_at` is computed from submission time, not `occurred_at`.** The PRD's Business Logic says "90 minutes after a meal is logged" — logged (submitted), not the user-entered `occurred_at` (which can be backdated and is display-only metadata). `due_at = now() + 90 minutes` at insert time, independent of `occurred_at`.
- **"Active pending check-in" = `completed_at is null AND superseded_by is null`.** This is the exact predicate for collision detection (does an unresolved post-meal check-in already exist?) and for the dashboard queue (add `due_at <= now()`). A superseded row stays in the table for history but is never itself actionable again.
- **RLS auto-scopes reads; inserts still need an explicit `user_id`.** `meals.user_id`/`check_ins.user_id` have no default referencing `auth.uid()` — every insert must set it explicitly from `context.locals.user.id`, even though RLS makes explicit `user_id` filters on `select` redundant (kept anyway as defense-in-depth on `update`/`delete` predicates).
- **Checkbox `FormData` semantics**: an unchecked HTML checkbox is absent from `FormData` entirely (not `"false"`). Symptom booleans must be derived via `form.has(fieldName)`, not `form.get(fieldName) as string`.
- **The defer rule is exactly one row of history deep.** Per PRD Business Logic: "Deferral replaces the pending check-in with a single new check-in due 90 minutes after the second meal" — there is no multi-hop re-collision handling to design for; a third meal arriving while a deferred check-in is still pending follows the exact same two-option flow against the (now current) active check-in.

## What We're NOT Doing

- No morning/evening fixed check-ins (S-02).
- No timeline view (S-03).
- No quiet hours (S-04) — every post-meal check-in is scheduled unconditionally in this slice.
- No CSV/JSON export (S-05).
- No automated test runner — manual verification only, matching F-01's precedent (explicit user decision this session).
- No new shadcn/ui primitives — `FormField`/`SubmitButton`/`ServerError` (plain Tailwind, not shadcn-dependent) are reused as-is; check-in completion checkboxes and the collision-decision buttons are plain server-rendered Astro `<form>` elements, not React islands.
- No fetch/JSON API layer — every mutation is a native `<form>` POST + full-page redirect, matching the existing auth pattern (explicit user decision this session).
- No dedicated `/meals` or `/check-ins` pages — everything lives on `/dashboard` (explicit user decision this session).

## Implementation Approach

Three phases, bottom-up: (1) a pure service layer encapsulating the collision/defer business rule behind Zod-validated inputs, independent of any route; (2) thin `APIRoute` handlers that parse `FormData`, call the service layer, and redirect — plus the middleware registration these routes need to be protected; (3) the dashboard UI wiring a new `MealForm` React island alongside server-rendered queue and collision-decision markup. Each phase is independently verifiable before the next depends on it working.

## Phase 1: Validation + service layer

### Overview

Adds `zod`, and a service layer in `src/lib/services/` implementing meal creation, collision detection, defer resolution, the due-check-ins query, and check-in completion — all as plain functions taking a Supabase client and validated input, with no knowledge of HTTP.

### Changes Required:

#### 1. Add Zod dependency

**Intent**: Enable schema validation for the three new inputs this feature accepts (meal creation, collision resolution, check-in completion) instead of hand-rolled `if` checks.

**Contract**: `npm install zod`. No config beyond the dependency itself.

#### 2. Validation schemas

**File**: `src/lib/validation/meal-tracking.ts`

**Intent**: One Zod schema per mutation entry point, shared between the future API routes and (indirectly) documented here as the single source of truth for valid input shape.

**Contract**: Exports `mealInputSchema` (`occurredAt: string`, refined to parse as a valid date — `datetime-local` input format has no timezone/seconds so plain `z.string().datetime()` does not apply; `description: string`, trimmed, `min(1)`, `max(2000)`), `collisionResolutionSchema` (`action: z.enum(["keep", "defer"])`, `pendingCheckInId: z.string().uuid()`, `mealId: z.string().uuid()`), and `checkInCompletionSchema` (`checkInId: z.string().uuid()`, plus the 6 symptom fields as `z.boolean()` — callers derive these via `FormData.has(...)` before passing to `.parse()`, per the checkbox-semantics discovery above).

#### 3. Meal + check-in service layer

**File**: `src/lib/services/check-ins.ts`

**Intent**: Isolate the collision/defer business rule and due-queue query behind named functions, independent of HTTP, so the route layer (Phase 2) stays thin.

**Contract**: Exports (all take a Supabase client + `userId` as leading args):
- `findActiveCheckIn(supabase, userId): Promise<CheckIn | null>` — the "active pending check-in" predicate from Key Discoveries.
- `scheduleCheckIn(supabase, userId, mealId): Promise<CheckIn>` — inserts with `due_at = now() + 90m`.
- `deferCheckIn(supabase, userId, activeCheckInId, mealId): Promise<CheckIn>` — inserts the new check-in, then updates `activeCheckInId.superseded_by` to point at it; returns the new row.
- `listDueCheckIns(supabase, userId): Promise<CheckIn[]>` — active-predicate + `due_at <= now()`, ordered `due_at asc`.
- `completeCheckIn(supabase, userId, checkInId, symptoms): Promise<CheckIn>` — sets `completed_at = now()` plus the 6 symptom columns.

**File**: `src/lib/services/meals.ts`

**Intent**: Compose meal creation with the collision check so callers get one call that returns either "check-in scheduled" or "collision — needs a decision."

**Contract**: Exports `createMealWithCheckIn(supabase, userId, { occurredAt, description }): Promise<{ meal: Meal; collision: CheckIn | null }>` — inserts the meal; if `findActiveCheckIn` returns null, calls `scheduleCheckIn` and returns `collision: null`; if it returns an existing check-in, returns it as `collision` without scheduling anything (Phase 2's route decides what to do with a non-null collision). Also exports `resolveCollision(supabase, userId, { action, pendingCheckInId, mealId }): Promise<void>` — `action: "defer"` calls `deferCheckIn`; `action: "keep"` is a no-op.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npm run build` succeeds

#### Manual Verification:

- In Supabase Studio's SQL editor (or a scratch script), call the service functions against the local DB (or verify via direct SQL matching the same predicates) and confirm: a fresh meal with no active check-in schedules one with `due_at` ~90 minutes out; a second meal while one is still active returns it as `collision` without creating a new check-in row.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: API routes + middleware protection

### Overview

Thin `APIRoute` handlers wiring `FormData` → Zod validation → the Phase 1 service layer → redirect, plus registering the new routes as protected.

### Changes Required:

#### 1. Middleware protection

**File**: `src/middleware.ts`

**Intent**: `/api/meals` and `/api/check-ins/*` must reject unauthenticated requests the same way `/dashboard` does, since they mutate per-user health data.

**Contract**: `PROTECTED_ROUTES` gains `"/api/meals"` and `"/api/check-ins"` (prefix match already used by the existing `startsWith` check covers both `/api/check-ins/collision` and `/api/check-ins/complete`).

#### 2. Create meal route

**File**: `src/pages/api/meals.ts`

**Intent**: Parse the meal form, validate, call `createMealWithCheckIn`; branch on whether a collision was returned.

**Contract**: `POST` `APIRoute`. On success with no collision: `redirect("/dashboard")`. On success with a collision: `redirect(\`/dashboard?collision=${collision.id}&meal=${meal.id}\`)`. On validation or Supabase error: `redirect(\`/dashboard?error=${encodeURIComponent(message)}\`)`, mirroring `signin.ts`'s error-redirect pattern.

#### 3. Collision resolution route

**File**: `src/pages/api/check-ins/collision.ts`

**Intent**: Handle the keep/defer decision submitted from the dashboard's collision card.

**Contract**: `POST` `APIRoute`. Parses `action`, `pendingCheckInId`, `mealId` from `FormData`, validates against `collisionResolutionSchema`, calls `resolveCollision`, then `redirect("/dashboard")` (clearing the query params) regardless of `keep` or `defer`.

#### 4. Complete check-in route

**File**: `src/pages/api/check-ins/complete.ts`

**Intent**: Handle one queue item's completion form.

**Contract**: `POST` `APIRoute`. Reads `checkInId` plus the 6 symptom checkbox fields via `form.has(...)`, validates against `checkInCompletionSchema`, calls `completeCheckIn`, then `redirect("/dashboard")`.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npm run build` succeeds

#### Manual Verification:

- `curl -i -X POST http://127.0.0.1:<port>/api/meals` without a session cookie returns a redirect to `/auth/signin` (middleware protection confirmed) rather than reaching the handler.
- With a valid session, POSTing well-formed meal data to `/api/meals` results in a `302` to `/dashboard` (no collision) and a new row in both `meals` and `check_ins` (verified via Supabase Studio).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Dashboard UI

### Overview

Wires the meal-logging form (React island), the due-check-ins queue, and the collision-decision block into `/dashboard`.

### Changes Required:

#### 1. Meal logging form

**File**: `src/components/meals/MealForm.tsx`

**Intent**: React island modeled directly on `SignInForm.tsx` — client-side pre-validation mirroring `mealInputSchema`'s shape, then a native form POST.

**Contract**: `<form method="POST" action="/api/meals">` with a `datetime-local` field (`occurredAt`) and a `description` textarea, reusing `FormField`, `ServerError`, `SubmitButton` from `src/components/auth/`. Exported as default, embedded in `dashboard.astro` via `<MealForm client:load serverError={...} />`.

#### 2. Dashboard composition

**File**: `src/pages/dashboard.astro`

**Intent**: Add the data-fetching and conditional rendering that turns the page from a static welcome screen into the north-star flow's home.

**Contract**: In frontmatter, create a Supabase client (`createClient(Astro.request.headers, Astro.cookies)`), read `collision`/`meal`/`error` from `Astro.url.searchParams`, and call `listDueCheckIns(supabase, user.id)`. Render, in order: (a) if `collision` is present, a collision-decision card (fetches the referenced check-in + meal for display, then renders two plain `<form method="POST" action="/api/check-ins/collision">` blocks — one with a hidden `action=keep` input, one with `action=defer` — both carrying `pendingCheckInId`/`mealId` hidden inputs) and nothing else below it, forcing resolution first; (b) otherwise, the `MealForm` island followed by the due-check-ins queue, each item a plain `<form method="POST" action="/api/check-ins/complete">` with a hidden `checkInId` and 6 labeled checkboxes.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npm run build` succeeds

#### Manual Verification:

- Log a meal via the dashboard form; confirm redirect back to `/dashboard` with no visible error.
- In Supabase Studio, manually set that check-in's `due_at` to a past timestamp; reload `/dashboard` and confirm it now appears in the queue.
- Complete it via the queue form; confirm it disappears from the queue and Studio shows `completed_at` set with the ticked symptom columns `true`.
- Log two meals in quick succession before completing the first check-in; confirm the collision card appears immediately after the second submission, blocking the rest of the dashboard.
- Choose "defer" on the collision card; confirm in Studio that the first check-in's `superseded_by` now points at a new row tied to the second meal, and that new row is the one appearing in the queue once due.
- Choose "keep" on a fresh collision (second meal logged while a different first check-in is active); confirm no new check-in row was created for the second meal and the original remains active.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- None — no test runner is configured in this project; explicit decision this session to keep this slice manual-only, matching F-01's precedent.

### Integration Tests:

- None automated. Supabase Studio + manual form submission serve as the integration check, as in F-01.

### Manual Testing Steps:

1. Log a meal, confirm a `check_ins` row is created with `due_at` ~90 minutes out.
2. Back-date that row's `due_at` via Supabase Studio's SQL editor to make it appear in the queue without waiting 90 minutes.
3. Complete the check-in, confirm `completed_at` and symptom columns land correctly.
4. Log two meals before completing the first's check-in; verify the collision card blocks the rest of the dashboard.
5. Test both "keep" and "defer" branches of the collision decision against separate collision instances, verifying `superseded_by` behavior in Studio each time.
6. Confirm an unauthenticated POST to each new API route redirects to sign-in rather than executing.

## Performance Considerations

None beyond what F-01 already deferred — no indexes added in this slice; query volume remains trivial at MVP scale.

## Migration Notes

No schema changes in this slice — F-01's schema already supports every query and mutation this plan describes.

## References

- Roadmap item: `context/foundation/roadmap.md` — S-01 (`post-meal-checkin-loop`), the milestone's North Star
- GitHub issue: https://github.com/mm987gmx/MealMirror/issues/2
- PRD: `context/foundation/prd.md` — US-01, FR-001 through FR-004, Business Logic (90-minute rule + defer rule)
- Prior change: `context/archive/2026-09-12-meal-checkin-data-schema/` — F-01, the schema this slice builds on

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Validation + service layer

#### Automated

- [x] 1.1 `npm run lint` passes — 9212920
- [x] 1.2 `npm run build` succeeds — 9212920

#### Manual

- [x] 1.3 Service functions verified against local DB: fresh meal schedules a check-in ~90 min out; colliding meal returns existing check-in without creating a new one — 9212920

### Phase 2: API routes + middleware protection

#### Automated

- [x] 2.1 `npm run lint` passes
- [x] 2.2 `npm run build` succeeds

#### Manual

- [x] 2.3 Unauthenticated POST to `/api/meals` redirects to sign-in
- [x] 2.4 Authenticated POST to `/api/meals` creates `meals` + `check_ins` rows and redirects to `/dashboard`

### Phase 3: Dashboard UI

#### Automated

- [ ] 3.1 `npm run lint` passes
- [ ] 3.2 `npm run build` succeeds

#### Manual

- [ ] 3.3 Meal logging via dashboard form works end-to-end
- [ ] 3.4 Back-dated check-in appears in the queue and completes correctly
- [ ] 3.5 Collision card appears on second meal and blocks the rest of the dashboard
- [ ] 3.6 "Defer" branch verified in Studio (`superseded_by` set correctly)
- [ ] 3.7 "Keep" branch verified in Studio (no new check-in row created)
