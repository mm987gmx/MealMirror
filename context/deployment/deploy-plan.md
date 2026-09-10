---
project: MealMirror
platform: cloudflare-workers
deployed_at: 2026-09-10
worker_name: meal-mirror
worker_url: https://meal-mirror.monika-mazza.workers.dev
version_id: 345cc4ab-6beb-4b57-918e-b4cc289be7a7
---

## What this is

Audit trail of the first real Cloudflare Workers deployment for MealMirror, executed via Plan Mode per the `CLAUDE.md` Lesson 5 chain. Platform decision and full risk register live in `context/foundation/infrastructure.md` — this file records what was actually done and what state production is in now.

## Pre-deploy changes

1. **`wrangler.jsonc`**: renamed Worker from the starter template's `10x-astro-starter` to `meal-mirror`.
2. **`package.json`**: added a `"deploy": "wrangler deploy"` script.
3. **`.dev.vars.example`** added at repo root (placeholders only, mirrors `.env.example`) as the local Workers-secret onboarding template.

## Bug found and fixed during verification

`npm run build` failed on the first attempt with `Could not find the prerender entry point in the build output. This is likely a bug in Astro.` Root cause: `package.json` carried a stale `"overrides": { "vite": "^7.3.2" }` (present since the initial scaffold commit) that force-pinned Vite to v7 across the whole dependency tree. `astro@7.0.6` and `@astrojs/cloudflare@14.1.1` both require Vite `^8.0.13` internally for their prerender bundling step (confirmed via each package's own `package.json`), so the override broke Astro's internal chunk-naming logic (`prerender-entry.[hash].mjs` was never produced).

**Fix**: removed the `overrides` block entirely and ran `npm install`. Result: `astro` and `@astrojs/cloudflare` each get their own nested `vite@8.3.0`; `@vitejs/plugin-react` and `@tailwindcss/vite` (whose peer ranges accept `^5–^8`) keep `vite@7.3.6`. Build succeeded cleanly afterward. This was not Cloudflare-specific — it would have blocked any deploy target — but it's exactly the class of risk flagged in the infra doc's risk register ("first real `wrangler deploy` has never been exercised end-to-end").

## Steps executed

1. `npm run build` — clean after the Vite fix above.
2. `npx wrangler dev` (local, workerd-emulated) — smoke-tested `/`, `/auth/signin`, `/auth/signup`, `/dashboard`. All passed (`200`, `200`, `200`, `302 → /auth/signin` for the unauthenticated dashboard redirect). No errors in the dev log.
3. Production secrets set via `npx wrangler secret put SUPABASE_URL` and `SUPABASE_KEY` (values from the Supabase project dashboard, entered directly by the user — never passed through the assistant). Confirmed present via `npx wrangler secret list`.
4. `npx wrangler deploy` — first attempt failed: the Cloudflare account had no `workers.dev` subdomain registered yet (one-time, account-level, human-only choice). User registered `monika-mazza` as the subdomain via the Cloudflare dashboard onboarding link. Re-ran `npx wrangler deploy` — succeeded.
5. Deploy auto-provisioned one new resource: a `SESSION` KV namespace (binding `env.SESSION`, name `meal-mirror-session`) — required by `@astrojs/cloudflare`'s session support, not explicitly configured in `wrangler.jsonc`.
6. Verified via `npx wrangler deployments list`: version `345cc4ab-6beb-4b57-918e-b4cc289be7a7` active at 100% traffic.
7. Post-deploy smoke check: re-tested the same four routes against `https://meal-mirror.monika-mazza.workers.dev` while running `npx wrangler tail --format json`. All four returned the expected status codes; tail showed `outcome: "ok"`, empty `exceptions: []`, and CPU times well under the free-tier 10ms cap (3–43ms observed).

## Current production state

- **Worker**: `meal-mirror`, live at `https://meal-mirror.monika-mazza.workers.dev`.
- **Secrets set**: `SUPABASE_URL`, `SUPABASE_KEY` (Workers Secrets, encrypted, not in any file).
- **Bindings**: `env.SESSION` (KV, `meal-mirror-session`), `env.IMAGES` (Cloudflare Images), `env.ASSETS` (static assets).
- **Auth used for deploy**: full-account OAuth token (`wrangler login`), not a scoped API token. Acceptable for a solo-dev MVP per the infra doc's posture, but should be tightened to a Worker-scoped API token before any CI/agent-driven deploy is added.
- **CI**: unchanged — `.github/workflows/ci.yml` still only lints + builds. Deploys remain manual (`npm run deploy` / `npx wrangler deploy`) by user decision; no auto-deploy-on-merge wired up.

## Rollback

`npx wrangler rollback [VERSION_ID]` (omit the ID to revert to the immediately prior version, `e0495ac4-44e7-4919-8fb9-2b3f5698c3bb`). Reverts Worker code only — does not affect Supabase schema/data or the `meal-mirror-session` KV namespace.

## Known gaps carried forward

- No `workers.dev` custom routes/domain — MVP scope, `workers.dev` subdomain only.
- No historical/queryable log store (would need paid Logpush) — see `context/foundation/infrastructure.md` risk register.
- Free tier's daily (not monthly) 100k-request cap and the 10ms CPU-time-per-invocation cap remain live risks; budget for the $5/mo Workers Paid plan before any public demo/share-out.
- Deploy auth is a full-account OAuth token rather than a scoped API token — fine for now, revisit if CI-driven deploys are added later.
