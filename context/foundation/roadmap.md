---
project: MealMirror
version: 1
status: draft
created: 2026-09-12
updated: 2026-09-12
prd_version: 1
main_goal: speed
top_blocker: time
milestone_id: checkin-tracking-mvp
milestone_seq: 1
milestone_status: open
---

# Roadmap: MealMirror

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Milestone

**M-1: Ship the core check-in tracking loop** — Status: open

- **Intent:** Deliver a working, single-user meal-and-symptom tracking loop end-to-end — meal logging, timed check-ins (post-meal, morning, evening), timeline, quiet hours, and data export — so real usage data can start accumulating toward the PRD's primary success criterion.
- **Source materials:** `context/foundation/prd.md` (v1)
- **Done when:** every F-NN and S-NN below is `done`.
- **Scope anchors:** US-01; FR-001 through FR-009; NFRs on response time, health-data privacy, and export; Access Control (single-user, authenticated).

## Vision recap

People with digestive complaints struggle to connect food to symptoms because journal entries made from memory are unreliable and irregular. MealMirror's core bet is that prompting the user for a symptom check-in at the right moment — 1.5–3h after a meal, plus fixed morning/evening check-ins — captures data while it's still fresh, instead of relying on the user's memory. Reliable data capture becomes a function of timing design, not user discipline.

## North star

**S-01: Log a meal and complete its triggered post-meal check-in** — this is the smallest end-to-end flow that proves the product's core hypothesis (timing-triggered check-ins actually get answered), so it is placed as early as its prerequisites allow.

> "North star" here means the smallest complete flow that, if it works, proves the product's central idea — everything else only matters once this loop is real.

## At a glance

| ID   | Change ID                     | Outcome (user can …)                                              | Prerequisites | PRD refs                    | Status   |
| ---- | ------------------------------ | ------------------------------------------------------------------ | -------------- | ---------------------------- | -------- |
| F-01 | meal-checkin-data-schema        | (foundation) meal & check-in tables exist, RLS-scoped to one user  | —              | Access Control, NFR (privacy) | done |
| S-01 | post-meal-checkin-loop          | log a meal and complete its triggered post-meal check-in           | F-01           | US-01, FR-001, FR-002, FR-003, FR-004 | done |
| S-02 | fixed-daily-checkins            | complete fixed morning and evening check-ins                       | F-01           | FR-003, FR-005, FR-006      | proposed |
| S-03 | symptom-timeline                | view a chronological timeline of meals and check-ins               | S-01           | FR-007                      | proposed |
| S-04 | quiet-hours-config              | configure quiet hours that suppress post-meal check-ins            | F-01, S-01     | FR-008                      | proposed |
| S-05 | export-tracking-data            | export all meals and check-ins as CSV or JSON                      | S-01           | FR-009                      | proposed |

## Baseline

What's already in place in the codebase as of `2026-09-12` (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** partial — Astro 7 + React 19 + Tailwind 4 + shadcn/ui wired (`components.json`, `src/components/ui/button.tsx`); routing exists only for auth pages (`src/pages/{index,dashboard,auth/*}.astro`); no domain UI for meals/check-ins/timeline.
- **Backend / API:** partial — Astro API route convention established (`src/pages/api/auth/{signin,signup,signout}.ts`); no domain endpoints; no validation library (Zod not a dependency).
- **Data:** absent — Supabase client configured (`src/lib/supabase.ts`), but no migrations exist (`supabase/migrations/` absent), no meal/check-in schema, no `src/types.ts`.
- **Auth:** present — Supabase auth via `@supabase/ssr`, email+password signin/signup/signout, route-protection middleware (`src/middleware.ts`), protected dashboard example. **FR-002 is already satisfied by this baseline** — no further auth work is needed; slices below reuse it as-is.
- **Deploy / infra:** present — Cloudflare Workers, live at `https://meal-mirror.monika-mazza.workers.dev` (see `context/foundation/infrastructure.md`, `context/deployment/deploy-plan.md`).
- **Observability:** absent — no logging, error tracking, or telemetry wired in (consistent with the PRD's "no passive telemetry" requirement).

## Foundations

### F-01: Meal & check-in data schema

- **Outcome:** (foundation) `meals` and `check_ins` tables exist in Supabase, with RLS policies scoped to the single authenticated user, minimally shaped to support FR-001 and FR-004 (no premature columns for later FRs).
- **Change ID:** meal-checkin-data-schema
- **PRD refs:** Access Control, NFR (privacy)
- **Unlocks:** S-01 (north star), S-02, S-04 — every vertical slice reads or writes this schema
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Every downstream slice depends on getting this shape right first; keep columns to exactly what US-01/FR-004 need today rather than pre-designing for FR-005 through FR-009 — those can extend the schema later without blocking this milestone's start.
- **Status:** done

## Slices

### S-01: Log a meal and complete its triggered post-meal check-in

- **Outcome:** user can submit a meal entry (date, time, free-text description), see it schedule a post-meal check-in due 1.5–3h later in a pending-check-ins queue, and complete that check-in with a binary tick per symptom — including the 90-minute timing rule and the same-window meal-collision defer choice described in the PRD's Business Logic.
- **Change ID:** post-meal-checkin-loop
- **PRD refs:** US-01, FR-001, FR-002, FR-003, FR-004
- **Prerequisites:** F-01
- **Parallel with:** S-02
- **Blockers:** —
- **Unknowns:**
  - Should meal logging get optional tags/categories to make patterns easier to spot later, or stay free-text as FR-001 states? — Owner: user. Block: no (PRD Open Question 2; free-text proceeds for MVP).
  - The ≥70% completeness goal depends on the user opening the app inside the check-in window — no reminder mechanism exists. — Owner: user. Block: no (PRD Open Question 3; behavioral risk, not a build blocker).
- **Risk:** This is the core hypothesis validation (do timing-triggered check-ins actually get answered?) — sequenced immediately after the schema so real usage data can start accumulating toward the 2-week ≥70% completeness goal as early as possible.
- **Status:** done

### S-02: Complete fixed morning and evening check-ins

- **Outcome:** user can complete a morning check-in (general wellbeing, skin condition) and an evening check-in (general wellbeing, bowel), each a binary tick per symptom, shown in the same pending-check-ins queue as post-meal check-ins.
- **Change ID:** fixed-daily-checkins
- **PRD refs:** FR-003, FR-005, FR-006
- **Prerequisites:** F-01
- **Parallel with:** S-01, S-03, S-04, S-05
- **Blockers:** —
- **Unknowns:**
  - Should skin condition use a defined rubric (clear / mild / severe) instead of a binary tick? — Owner: user. Block: no (PRD Open Question 4; binary tick proceeds for MVP).
- **Risk:** Simpler than S-01 (no timing engine, fixed daily prompts) and has no dependency on it — sequencing it in parallel makes efficient use of the time-constrained MVP window.
- **Status:** proposed

### S-03: View a symptom timeline

- **Outcome:** user can view a chronological timeline of meals and check-ins with clear visual separation between the two entry types.
- **Change ID:** symptom-timeline
- **PRD refs:** FR-007
- **Prerequisites:** S-01
- **Parallel with:** S-02, S-04, S-05
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Needs at least one completed check-in cycle (S-01) to have two distinguishable entry types to separate visually; validates the PRD's secondary success criterion (find a past entry in under a minute) while usage data is still small, so worth sequencing early rather than last.
- **Status:** proposed

### S-04: Configure quiet hours

- **Outcome:** user can configure a quiet-hours window (e.g., 23:00–07:00) during which post-meal check-ins are suppressed rather than queued; morning and evening fixed check-ins are unaffected.
- **Change ID:** quiet-hours-config
- **PRD refs:** FR-008
- **Prerequisites:** F-01, S-01
- **Parallel with:** S-02, S-03, S-05
- **Blockers:** —
- **Unknowns:** —
- **Risk:** A refinement of S-01's scheduling logic rather than a new data shape — low technical risk, but FR-008 is must-have, so it stays in this milestone's build order rather than getting parked.
- **Status:** proposed

### S-05: Export tracking data

- **Outcome:** user can export all meals and check-ins as CSV or JSON, in a form usable in a spreadsheet or shareable with a doctor or dietitian.
- **Change ID:** export-tracking-data
- **PRD refs:** FR-009
- **Prerequisites:** S-01
- **Parallel with:** S-02, S-03, S-04
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Lowest technical risk of the milestone (a data dump over the existing schema) — sequenced last among slices since there's nothing meaningful to export until real data exists, but the NFR requiring on-request export means it stays in this milestone rather than getting parked.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID              | Suggested issue title                                  | Ready for `/10x-plan` | GitHub Issue | Notes                          |
| ---------- | ----------------------- | -------------------------------------------------------- | ---------------------- | ------------ | ------------------------------- |
| F-01       | meal-checkin-data-schema | Create meal & check-in schema with per-user RLS          | yes                     | [#1](https://github.com/mm987gmx/MealMirror/issues/1) | —                                |
| S-01       | post-meal-checkin-loop  | Log a meal and complete its triggered post-meal check-in | no                      | [#2](https://github.com/mm987gmx/MealMirror/issues/2) | Waiting on F-01                 |
| S-02       | fixed-daily-checkins    | Complete fixed morning and evening check-ins             | no                      | [#3](https://github.com/mm987gmx/MealMirror/issues/3) | Waiting on F-01                 |
| S-03       | symptom-timeline        | View a chronological symptom timeline                    | no                      | [#4](https://github.com/mm987gmx/MealMirror/issues/4) | Waiting on S-01                 |
| S-04       | quiet-hours-config      | Configure quiet hours for post-meal check-ins            | no                      | [#5](https://github.com/mm987gmx/MealMirror/issues/5) | Waiting on F-01, S-01           |
| S-05       | export-tracking-data    | Export meals and check-ins as CSV/JSON                   | no                      | [#6](https://github.com/mm987gmx/MealMirror/issues/6) | Waiting on S-01                 |

## Open Roadmap Questions

1. **US-02 through US-N: additional user stories** — Stories for check-in completion, timeline browsing, quiet hours configuration, and data export weren't drafted individually in the PRD; FRs above are treated as sufficient to plan from. Owner: TBD. Block: no.
2. **FR-001 — meal categorization** — Should optional tags or a rough category be added to meal logging to make patterns easier to spot? Owner: user. Block: no.
3. **FR-003 — completeness risk** — The ≥70% data-completeness goal depends on the user opening the app inside the check-in window; there's no reminder mechanism. Owner: user. Block: no.
4. **FR-005 — skin condition rubric** — Should skin condition use a defined scale (clear / mild / severe) instead of a binary tick? Owner: user. Block: no.
5. **Pain type priority** — Whether decision paralysis ("which food to avoid") deserves equal product surface alongside data-capture and communication-gap pain types. Owner: user. Block: no.

## Parked

- **Date range filter on the timeline** — Why parked: PRD dropped this from MVP scope (Socratic resolution on FR-008/timeline) — with only 2 weeks of data, a filter solves a problem that doesn't exist yet; deferred to v2.
- **Automatic analysis / diagnostic verdicts** — Why parked: PRD Non-Goals — no inference engine or intolerance claims; requires clinical validation out of scope for MVP.
- **Native mobile app (iOS/Android)** — Why parked: PRD Non-Goals — web browser only for MVP.
- **Multi-user accounts / onboarding flow** — Why parked: PRD Non-Goals — MVP is single-user; registration and shared features deferred.
- **Food database, calorie counting, macros, photo logging** — Why parked: PRD Non-Goals — meal entry is free-text only; nutrition tracking is out of scope.
- **Push notifications or background jobs** — Why parked: PRD Non-Goals — trigger mechanism is pending-queue-on-login only.
- **Wearable integration (Apple Watch, etc.)** — Why parked: PRD Non-Goals — manual data entry only for MVP.
- **HealthKit / sleep / HRV / activity data integration** — Why parked: PRD Non-Goals — scope limited to self-reported meals and symptoms.

## Milestone History

(empty — first milestone)

## Done

- **F-01: (foundation) `meals` and `check_ins` tables exist in Supabase, with RLS policies scoped to the single authenticated user, minimally shaped to support FR-001 and FR-004 (no premature columns for later FRs).** — Archived 2026-09-12 → `context/archive/2026-09-12-meal-checkin-data-schema/`. Lesson: —.
- **S-01: user can submit a meal entry (date, time, free-text description), see it schedule a post-meal check-in due 1.5–3h later in a pending-check-ins queue, and complete that check-in with a binary tick per symptom — including the 90-minute timing rule and the same-window meal-collision defer choice described in the PRD's Business Logic.** — Archived 2026-09-12 → `context/archive/2026-09-12-post-meal-checkin-loop/`. Lesson: —.
