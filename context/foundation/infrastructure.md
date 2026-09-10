---
project: MealMirror
researched_at: 2026-09-10
recommended_platform: Cloudflare Workers
runner_up: Vercel
context_type: mvp
tech_stack:
  language: typescript
  framework: astro-7-react-19
  runtime: cloudflare-workers-workerd
---

## Recommendation

**Deploy on Cloudflare Workers.**

The project already ships `@astrojs/cloudflare@^14.1.1` (Workers-only as of this adapter major — Cloudflare Pages support was dropped from the adapter itself) and `wrangler@^4.90.0`, with `CLAUDE.md` already documenting `npx wrangler deploy` as the deploy command. Workers passes all five agent-friendly criteria at GA maturity, costs $0–5/month at this project's scale (dozens of users, low QPS), and needs zero adapter migration — every other candidate requires swapping the Astro adapter and re-wiring env vars. The single-region interview answer and "no persistent connections" answer remove any pull toward Fly.io/Railway/Render's always-on-container model, and the "don't know yet" co-location answer is moot since Supabase already externally owns auth+DB regardless of platform choice.

## Platform Comparison

| Platform | CLI-first | Managed/Serverless | Agent-readable docs | Stable deploy API | MCP / Integration | Total |
|---|---|---|---|---|---|---|
| Cloudflare Workers | Pass | Pass | Pass | Pass | Pass | 5/5 |
| Vercel | Pass | Pass | Pass | Pass | Pass | 5/5 |
| Netlify | Partial | Pass | Pass | Pass | Pass | 4.5/5 |
| Render | Partial | Partial | Pass | Pass | Pass | 4/5 |
| Railway | Partial | Partial | Pass | Pass | Pass | 4/5 |
| Fly.io | Pass | Fail | Pass | Pass | Partial | 3.5/5 |

Notes per platform:

- **Cloudflare Workers**: `wrangler deploy` / `wrangler rollback` / `wrangler tail` are all GA, scriptable, non-interactive. Fully serverless — no Dockerfile, no machine sizing. `developers.cloudflare.com/workers/llms.txt` plus per-page markdown mirrors. Official OAuth MCP server catalog. Only soft spot: no first-party persistent log store without paid Logpush, and free-tier request accounting resets **daily** (100k/day), not monthly.
- **Vercel**: `vercel` / `vercel rollback` / `vercel logs` all GA. Serverless functions via `@astrojs/vercel`. `vercel.com/llms.txt` present, official MCP server (`mcp.vercel.com`) GA. Scored equal to Cloudflare on the five criteria, held to runner-up only by migration cost and a Hobby-tier ToS restriction (non-commercial use) that doesn't apply to Cloudflare's free tier.
- **Netlify**: `netlify deploy --prod` / `netlify logs` are GA, but **rollback has no CLI command** — dashboard-only ("Publish deploy"), which is the one real gap against the CLI-first criterion. Otherwise strong: `docs.netlify.com/llms.txt`, official MCP server, official Supabase extension for env var wiring.
- **Render**: Mature CLI (`render` v2.27) but rollback is still dashboard/health-check-driven rather than a direct CLI verb. More importantly, the **free tier spins down after 15 min idle** with a 30–60s cold start — a direct conflict with the kind of "instant feel" MealMirror's product is built around, so the cheapest viable tier is the **$7/mo Starter (always-on)**, not free.
- **Railway**: No dedicated CLI rollback-to-arbitrary-version command (dashboard/API only for older builds). No free tier anymore (Hobby floor ~$5/mo). Own co-located Postgres would sit entirely unused since Supabase already owns the data layer — pure redundant spend if provisioned.
- **Fly.io**: Genuine strength on persistent processes/WebSockets (not needed here) and CLI/docs quality, but it's the only candidate that is **not serverless** — requires maintaining a Dockerfile and a `fly.toml`, with machines that auto-stop on idle (cold start) by default. No free tier since Oct 2024; realistic small-app cost is $8–25/month, the highest of the six. MCP integration is community/experimental only, not first-party GA.

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Already the installed adapter and documented deploy path — this is a "confirm and harden," not a "choose and migrate," decision. Full marks on all five criteria, lowest cost floor ($0–5/mo) at this project's traffic, official MCP tooling if agent-driven operations are ever needed beyond CLI. The trade-offs (CPU-time budgeting, no built-in persistent log store, no native background-job primitive) are real but match a product that explicitly has no background-job requirement in its PRD.

#### 2. Vercel

Functionally tied with Cloudflare on the scoring criteria — mature CLI, GA MCP server, GA serverless functions via the official Astro adapter. Loses out only because it requires migrating off the already-installed `@astrojs/cloudflare` adapter for no functional gain, and because MealMirror's health-tracking nature makes the Hobby plan's non-commercial ToS restriction worth double-checking before committing (Pro is $20/mo if that restriction applies).

#### 3. Netlify

Third by a narrow margin — everything Vercel offers, plus an official Supabase extension for env var wiring, but the missing CLI rollback command (UI-only) is a real gap against an agent-operated workflow, and it shares the same "requires adapter migration for no functional gain" downside as Vercel.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **Untested deploy path.** Nobody has run a real end-to-end `wrangler deploy` against the current dependency versions in this repo — `CLAUDE.md` itself was found to carry stale version claims (Astro 6 vs. the actual 7) before a prior correction, so "the deploy command is documented" is not the same as "the deploy command has been exercised."
2. **Documented React 19 + workerd SSR issue history.** GitHub issues #12824 (`MessageChannel is not defined`), #16529 (invalid hook call after an Astro/React adapter upgrade), #16387 (dev-mode Vite corruption combining the Cloudflare adapter + Actions + React islands), and #16973 (up to 10x build-time regression) all touch this exact combination. They appear fixed in current adapter versions, but that's an inference from changelogs, not a verified fact for this repo's exact version pins.
3. **Weak observability by default.** `wrangler tail` is real-time-only; there is no queryable historical log store without configuring paid Logpush — debugging an intermittent production issue after the fact is harder here than on an always-on container host.
4. **Optimistic cost story.** The free tier's 10ms CPU-time-per-invocation cap is easy to exceed with server-rendered React (SSR markup generation, chart/timeline rendering) — research explicitly flagged that the $5/mo paid tier is the realistic floor, not the $0 headline number.
5. **No native background-job primitive.** The request-scoped, no-persistent-process execution model means any future feature needing even a lightweight scheduled task (a reminder nudge, a nightly export job) requires learning Cron Triggers/Durable Objects from scratch — more retrofitting friction than starting on a host with an always-on process, even though the current PRD explicitly excludes background jobs from MVP scope.

### Pre-Mortem — How This Could Fail

Six months in, MealMirror's Cloudflare Workers deployment became a source of quiet friction. The initial "it's already wired up" choice never got a real production smoke test before shipping — the first time full Astro SSR plus React 19 hydration ran under real user load, a handful of requests silently failed when the CPU-time cap tripped on a slower render (the timeline view, doing more work per request than expected). Because Workers logs are ephemeral and Logpush was never configured — a budget-conscious call by a solo developer — there was no way to retroactively diagnose which requests failed or why. Meanwhile the product grew exactly one feature the PRD had explicitly deferred: a gentle nightly reminder notification. Building it meant learning Cron Triggers and Durable Objects from scratch instead of writing an ordinary background job the way any Node host would allow. The $0/month cost that made the platform attractive quietly crept to the $5 tier, then needed Logpush for observability, eroding the original cost rationale. In hindsight, the team optimized for "zero migration work today" over "operational transparency during growth," and only noticed the gap when something broke silently in production with no way to see why.

### Unknown Unknowns

- The 10ms CPU-time limit measures **CPU time only, not wall-clock/I/O wait** — a slow Supabase network round-trip doesn't count against it. Most quick reads of "10ms limit" don't make this distinction, leading to either misplaced fear or misplaced confidence about where the real risk sits (CPU-bound rendering, not network calls).
- `astro:env/server` and Cloudflare bindings can behave differently between `wrangler dev` (local, workerd-emulated) and a real `wrangler deploy` (edge) — a "works locally" result is not proof it works in production; a `--dry-run` or preview-environment check is the only way to be sure before a real cutover.
- Cloudflare's own migration off Pages onto Workers-only means a large share of currently-indexed tutorials, Stack Overflow answers, and even AI training data still describe the legacy Pages deploy flow — anyone (human or agent) searching "deploy Astro to Cloudflare" today has a real chance of landing on instructions that don't apply to the adapter version already installed here.
- Free-tier request accounting resets **daily** (100k/day), not monthly — a single traffic spike (e.g., demoing the app to a doctor and sharing the link) could exhaust the daily cap and produce hard failures for the rest of that day, unlike platforms that bill overage instead of hard-stopping.
- `wrangler rollback` reverts Worker code only — it has no awareness of Supabase. If a bad deploy also shipped a breaking Supabase migration, a "rollback" only ever half-reverts the incident; the database side needs its own, separate rollback discipline.

## Operational Story

- **Preview deploys**: Cloudflare Workers supports versioned deployments and gradual rollout via `wrangler versions upload` / `wrangler versions deploy`, but there is no automatic per-PR preview URL wired up yet in this repo — that needs to be added to the GitHub Actions workflow (`.github/workflows/ci.yml` currently only runs lint + build) if PR-level preview is wanted.
- **Secrets**: `SUPABASE_URL` / `SUPABASE_KEY` are declared as `astro:env/server` variables (optional, `null`-safe per `src/lib/supabase.ts`). In production they must be set via `wrangler secret put SUPABASE_URL` / `wrangler secret put SUPABASE_KEY` (Workers Secrets), not committed to `wrangler.toml`. Locally they live in the gitignored `.dev.vars`. Per this project's Lesson 5 posture: use a Cloudflare API token scoped to this Worker only (no DNS, no unrelated Workers Secrets, no billing) for any CI/agent-driven deploy — never a global API key.
- **Rollback**: `wrangler rollback [VERSION_ID]` (omit the ID to revert to the immediately prior version). Reverts Worker code only, in seconds — it does **not** revert Supabase schema/data changes, so a deploy that pairs a code change with a Supabase migration needs a manual, coordinated rollback plan for the database side.
- **Approval**: Routine `wrangler deploy` / `wrangler rollback` for this single Worker are safe for an agent to run unattended once a scoped token is in place. Human-only: rotating the Supabase service-role key, any DNS/zone-level change, and any action needing the Cloudflare account's global API key or billing access.
- **Logs**: `wrangler tail` for live request/console logs (`--format json` for structured output an agent can parse, `--status error` to filter). `wrangler deployments list` / `wrangler deployments view <ID>` for deploy history. No historical log query without configuring paid Logpush — treat this as a known gap, not a blocker, at MVP scale.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| First real `wrangler deploy` has never been exercised end-to-end against current dependency versions | Devil's advocate | M | H | Run a full `npm run build` + `wrangler dev` + a real `wrangler deploy` to a preview/staging environment before the first production cutover; treat this as the Plan Mode deploy's explicit verification step |
| React 19 SSR under `workerd` has a documented history of `MessageChannel`/hook/build-time bugs (GH #12824, #16529, #16387, #16973) | Devil's advocate | L–M | H | Pin `@astrojs/cloudflare` and `@astrojs/react` to the exact versions already in `package.json`, do a smoke test of every route (esp. any island using dynamic `import()` in an inline `<script>`) before first deploy, and re-check these issues on any future dependency bump |
| Free tier's 10ms CPU-time-per-invocation cap can be exceeded by SSR + React rendering, silently failing requests | Devil's advocate / Pre-mortem | M | M | Budget for the $5/mo Workers Paid plan from day one rather than assuming $0; watch `wrangler tail --status error` after the first real deploy for CPU-limit errors |
| No historical/queryable log store without paid Logpush — a silent production failure is hard to diagnose after the fact | Pre-mortem | M | M | Accept the gap for MVP scale; if a debugging need arises, add Logpush or the Cloudflare Workers Observability dashboard rather than reaching for a bigger platform migration |
| Free-tier request accounting resets daily (100k/day) — a single sharing/demo spike could exhaust it and hard-fail the rest of that day | Unknown unknowns | L | M | Move to the $5/mo Paid plan (10M requests included) before any planned demo, share-out, or public link |
| Stale Cloudflare Pages-era tutorials/training data may lead a future agent or contributor to reintroduce Pages-specific config against a Workers-only adapter | Unknown unknowns | M | L | Keep `CLAUDE.md`'s "Deployed to Cloudflare Workers" statement authoritative; if any agent proposes `wrangler pages deploy` or a `_routes.json`/Pages-only config, treat it as a signal to re-check the adapter docs, not follow it |
| `wrangler rollback` reverts Worker code only, not Supabase schema/data — a rollback after a paired deploy+migration only half-fixes an incident | Unknown unknowns | L | H | Never ship a Supabase migration in the same deploy as a risky code change without a written-down manual DB rollback step; keep migrations additive/backward-compatible where possible |
| No native background-job primitive — a future in-scope feature (e.g., reminders) would require learning Cron Triggers/Durable Objects from scratch | Devil's advocate / Pre-mortem | L | L | Out of scope for current PRD (no background jobs required); revisit only if a future PRD revision adds one, and treat it as a scoped follow-up research question, not a blocker today |

## Getting Started

1. Confirm the Cloudflare API token used for deploys is scoped to this Worker only (no DNS, no unrelated secrets, no billing) — set it as `CLOUDFLARE_API_TOKEN` in the environment used for local/CI deploys, not committed anywhere.
2. Set production secrets: `wrangler secret put SUPABASE_URL` and `wrangler secret put SUPABASE_KEY` (values from the Supabase project dashboard).
3. Run a full local verification pass before the first real deploy: `npm run build` (production build) then `npx wrangler dev` (workerd-emulated local run) to catch any Astro/React/Cloudflare-adapter SSR issue before it reaches production.
4. Deploy: `npx wrangler deploy`. Confirm with `npx wrangler deployments list` that the new version is live.
5. Tail logs for the first few real requests: `npx wrangler tail --format pretty --status error` to catch any CPU-time-limit or SSR error immediately after cutover.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup (beyond noting the existing `.github/workflows/ci.yml` runs lint + build only, no deploy step)
- Production-scale architecture (multi-region, HA, DR)
