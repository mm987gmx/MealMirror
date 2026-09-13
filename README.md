# MealMirror

A meal and symptom tracker for people with recurring digestive complaints.

Traditional food journals fail because entries get written from memory, hours after the fact. MealMirror's bet is that **timing is the product**: when you log a meal, the app schedules a symptom check-in 90 minutes later and puts it in your path the next time you open the app — while the symptoms are still fresh. Over a couple of weeks that turns into a dataset you can actually show a doctor or dietitian.

The product deliberately never diagnoses anything. It captures raw co-occurrence between what you ate and how you felt, and leaves the interpretation to a human.

## Tech stack

Astro 7 with React 19 islands, TypeScript and Zod end-to-end, Tailwind 4 for styling, Supabase for Postgres and auth, deployed to Cloudflare Workers. Tests run on Vitest against a real local Supabase instance, plus Playwright for the one browser-level scenario that needs a real DOM.

The reasoning behind each of these choices is written up in [`context/foundation/tech-stack.md`](context/foundation/tech-stack.md) and [`context/foundation/infrastructure.md`](context/foundation/infrastructure.md).

## Running it locally

You need Node 22.14.0 (see `.nvmrc`) and Docker with roughly 7 GB of RAM available for the local Supabase stack.

```bash
npm install
npx supabase start          # boots Postgres, Auth and Studio in Docker
cp .env.example .env        # paste the SUPABASE_URL and SUPABASE_KEY the CLI printed
cp .env.example .dev.vars   # same values — Cloudflare's local dev runtime reads this one
npm run dev
```

Migrations in `supabase/migrations/` are applied automatically by `supabase start`. Supabase Studio is at `http://localhost:54323`, and sign-up is open at `/auth/signup`, so you can create your own account on first run.

Local Supabase requires email confirmation by default. Either turn it off in Studio under **Authentication → Email → Confirm email**, or grab the confirmation mail from the built-in inbox at `http://localhost:54324`.

### Tests

```bash
npm test         # Vitest: unit + integration against local Supabase
npm run test:e2e # Playwright: the collision/defer race scenario
```

Both commands auto-start Supabase if it isn't already running (`scripts/ensure-supabase-running.mjs`). They need `.env.test` — copy it from `.env.test.example` and fill in the local anon and service-role keys. Every test creates and tears down its own throwaway user, so runs don't pollute each other.

## How the app works

### Authentication

Email and password via Supabase Auth, with sign-in, sign-up and sign-out under `/auth/*`. `src/middleware.ts` guards `/dashboard`, `/api/meals` and `/api/check-ins`, redirecting anonymous requests to the sign-in page.

Data is scoped to its owner twice over. Every row in `meals` and `check_ins` carries a `user_id`, Postgres row-level security restricts all four operations to `auth.uid() = user_id`, and the service layer additionally filters on `user_id` so a bug in one layer isn't enough to leak data. There's a test that proves it: one authenticated user cannot read, edit or delete another's meal even when handed the exact row ID.

### Working with meals

| Operation | Where | Notes |
| --- | --- | --- |
| Create | `POST /api/meals` | Logs the meal and schedules its check-in |
| Read | `listMeals` on the dashboard | Newest first, each meal tagged with its check-in status |
| Update | `POST /api/meals/:id` with `intent=update` | Edits time and description |
| Delete | `POST /api/meals/:id` with `intent=delete` | Cascades the meal's check-ins away with it |

Update and delete travel over `POST` with an `intent` field rather than `PATCH` and `DELETE`, because the whole UI is built on plain HTML forms and keeps working with JavaScript disabled.

Two behaviours are deliberate rather than accidental. Editing a meal does **not** move its pending check-in: the 90-minute window is anchored to when the meal was logged, so allowing an edit to shift it would be a way to dodge a check-in that's already due. And deleting a meal takes its check-ins with it, because a recorded symptom means nothing once the meal it describes is gone.

Check-ins are answered, not created or deleted by hand — they only exist as a consequence of a meal, so exposing standalone create and delete for them would let the data drift out of sync with reality.

### The check-in engine

This is where the interesting logic lives (`src/lib/services/check-ins.ts` and `meals.ts`).

Logging a meal schedules a post-meal check-in due 90 minutes later. It shows up in the pending queue once that time passes, and you answer it with a binary tick per symptom: stomach pain, heartburn, bloating, bowel issues, general wellbeing, dry mouth.

The hard part is what happens when you eat again before answering. MealMirror enforces **one active check-in per user**, so a second meal logged inside an open window triggers an explicit choice:

- **Keep** the original check-in at its current time. The second meal gets no check-in of its own.
- **Defer** it to the new meal. The original is marked superseded and a fresh check-in is scheduled 90 minutes out.

Deferring runs inside the `defer_check_in` Postgres function so the supersede and the insert land atomically, and a partial unique index enforces the one-active-check-in rule at the database level. If two browser tabs try to defer the same check-in at once, exactly one wins and the other gets a "this was already resolved elsewhere" message instead of silently corrupting the chain.

## Project documentation

This project was built through a documented workflow, and the artefacts are part of the repository rather than an afterthought.

[`context/foundation/`](context/foundation/) holds the durable picture: [`prd.md`](context/foundation/prd.md) with the vision, personas, functional requirements and the counter-arguments each one survived; [`roadmap.md`](context/foundation/roadmap.md) with the milestone broken into slices tied back to PRD references and GitHub issues; [`test-plan.md`](context/foundation/test-plan.md) with a ranked risk map, the phased rollout that addresses it, and an explicit list of what the project deliberately doesn't test; plus `tech-stack.md` and `infrastructure.md` for the stack and deployment reasoning.

[`context/changes/`](context/changes/) tracks work in flight and [`context/archive/`](context/archive/) keeps the research, plans and reviews from completed slices.

## Testing approach

The suite is deliberately small and risk-driven — [`test-plan.md`](context/foundation/test-plan.md) §1 sets the rule that each risk is covered once, at the cheapest layer that gives real signal.

Integration tests run against real Postgres rather than mocks, because the risks worth covering here (the collision chain, the single-active-check-in invariant, cross-user isolation) live in the interaction between application code and database constraints — exactly what a mock would paper over. The concurrency tests fire requests through `Promise.all` and assert the invariant holds regardless of how they interleave.

One Playwright spec exists, covering the two-tab defer race, because that's the only risk that genuinely needs a browser: it has to prove the error message is *visible in the DOM*, not merely present in a redirect URL.

## Deployment

Deployed to Cloudflare Workers.

```bash
npm run build
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_KEY
npx wrangler deploy
```

GitHub Actions runs lint and build on every push and pull request to `master`; `SUPABASE_URL` and `SUPABASE_KEY` need to be set as repository secrets for the build step. Rollback is `npx wrangler rollback` — note that it reverts Worker code only, never Supabase schema, so a deploy paired with a migration needs its own database rollback plan.

## License

MIT
