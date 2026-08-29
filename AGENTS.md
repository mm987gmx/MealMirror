# Repository Guidelines

MealMirror is an Astro 7 SSR web app (React 19 islands, Tailwind 4, Supabase auth, shadcn/ui) deployed to Cloudflare Workers. It currently only has the auth scaffold implemented — see `@CLAUDE.md` for product scope and current implementation state.

## Agent-specific instructions

- No validation library is installed (`zod` is not a dependency) — form inputs in `src/pages/api/**` are read from `FormData` with a raw `as string` cast. Do not assume Zod schemas exist; if you add validation, add the dependency first.
- `output: "server"` in `astro.config.mjs` makes every route server-rendered by default; no route currently sets `prerender`. Don't add `export const prerender = false` to new API routes — it's a no-op here.
- `supabase/migrations/` is empty — no tables exist beyond Supabase's built-in `auth.users`. Any new table must ship with RLS enabled and per-operation, per-role policies in the same migration, named `YYYYMMDDHHmmss_short_description.sql`.
- JSON API error responses use the flat shape `{ error: string }` (not a nested `{ error: { message } }` object) — `400` for validation failures, `500` for downstream/unexpected failures (Supabase errors included; not `502`, Supabase isn't an upstream proxy). Success responses use an entity-keyed object, e.g. `{ meal: {...} }`, not a generic `{ data: {...} }` wrapper.

## Project Structure & Module Organization

`src/pages/` — Astro pages and `src/pages/api/` route handlers. `src/components/` — Astro components for static content, React (`.tsx`) only where interactive; `src/components/ui/` holds shadcn/ui primitives (`new-york` style, installed via `npx shadcn@latest add <name>`). `src/lib/` — helpers/services (e.g. `supabase.ts`, `utils.ts`); `src/middleware.ts` resolves the session and redirects unauthenticated requests away from routes listed in `PROTECTED_ROUTES`. `context/foundation/` holds the PRD and tech-stack rationale (`@context/foundation/prd.md`).

## Build, Test, and Development Commands

- `npm run dev` — Cloudflare workerd dev server.
- `npm run build` — production SSR build.
- `npm run preview` — preview the production build.
- `npm run lint` / `npm run lint:fix` — type-checked ESLint.
- `npm run format` — Prettier (`prettier-plugin-astro`, `prettier-plugin-tailwindcss`).

No test script or test framework is configured.

## Coding Style & Naming Conventions

2-space indent, double quotes, semicolons, 120-char print width, trailing commas (`@.prettierrc.json`). Path alias `@/*` → `./src/*`. Use the `cn()` helper (`@src/lib/utils.ts`) for merged/conditional Tailwind classes instead of string concatenation. API route handlers export uppercase HTTP verbs (`GET`, `POST`) per `@src/pages/api/auth/signin.ts`. React components use no Next.js directives (no `"use client"`).

## Commit & Pull Request Guidelines

History is a single initial commit — no established convention to follow yet.

## Security & Configuration Tips

`SUPABASE_URL` / `SUPABASE_KEY` are declared as server-only secrets via `astro:env/server` (`astro.config.mjs` `env.schema`), never exposed to the client. Local secrets go in `.env` (Node) or `.dev.vars` (Cloudflare, gitignored) — copy from `@.env.example`. CI (`@.github/workflows/ci.yml`) runs `astro sync`, lint, and build on push/PR to `master`, requiring `SUPABASE_URL`/`SUPABASE_KEY` repo secrets.
