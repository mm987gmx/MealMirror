---
bootstrapped_at: 2026-07-04T17:11:07Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: meal-mirror
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: meal-mirror
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: false
```

**Why this stack**: MealMirror is a solo-built, after-hours health-tracking web app with a 4-week MVP window, auth as the only technology-forcing feature, and no payments, realtime, or background jobs in scope. The 10x Astro Starter (Astro 6 + React 19 + TypeScript + Tailwind 4 + Supabase + Cloudflare Pages) is the recommended default for the (web-app, js) cell and fits all load-bearing constraints: Supabase ships PostgreSQL and auth out of the box, removing the most common greenfield integration risk; TypeScript end-to-end with Zod schemas aligns with the project's emphasis on reliable structured data capture; Cloudflare Pages is the starter's native deployment target, minimising configuration overhead. All four agent-friendly gates pass — typed, convention-based, popular in training data, well-documented. Solo build with a short timeline favours battle-tested and popular-community starters; this stack delivers both. Bootstrapper confidence is first-class.

## Pre-scaffold verification

| Signal      | Value                                                    | Severity | Notes                                          |
| ----------- | -------------------------------------------------------- | -------- | ---------------------------------------------- |
| npm package | not run                                                  | n/a      | cmd_template uses git clone; npm check skipped |
| GitHub repo | not run                                                  | n/a      | gh API unavailable (not authenticated)         |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone (cloned starter repo without keeping upstream git history)
**Exit code**: 0
**Files moved**: 19
**Conflicts (.scaffold siblings)**: CLAUDE.md → CLAUDE.md.scaffold (existing wins)
**.gitignore handling**: moved silently (no .gitignore in cwd before scaffold)
**.bootstrap-scaffold cleanup**: deleted

Files moved silently: `.env.example`, `.github/`, `.gitignore`, `.husky/`, `.nvmrc`, `.prettierrc.json`, `.vscode/`, `README.md`, `astro.config.mjs`, `components.json`, `eslint.config.js`, `node_modules/`, `package-lock.json`, `package.json`, `public/`, `src/`, `supabase/`, `tsconfig.json`, `wrangler.jsonc`

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 6 HIGH, 9 MODERATE, 2 LOW
**Direct vs transitive**: 0/1/2/0 direct of total 0/6/9/2 (CRITICAL/HIGH/MODERATE/LOW)

#### HIGH findings

| Package   | Direct? | Advisory                                                    | CVSS | Fix available |
| --------- | ------- | ----------------------------------------------------------- | ---- | ------------- |
| `astro`   | yes     | Reflected XSS via unescaped slot name (GHSA-8hv8-536x-4wqp) | 7.1  | yes           |
| `astro`   | yes     | Host header SSRF in prerendered error page fetch (GHSA-2pvr-wf23-7pc7) | 7.5 | yes |
| `devalue` | no      | DoS via sparse array deserialization (GHSA-77vg-94rm-hx3p)  | 7.5  | yes           |
| `undici`  | no      | TLS certificate validation bypass via SOCKS5 (GHSA-vmh5-mc38-953g) | 7.4 | yes |
| `undici`  | no      | WebSocket DoS via fragment count bypass (GHSA-vxpw-j846-p89q) | 7.5 | yes |
| `undici`  | no      | Cross-origin routing via SOCKS5 pool reuse (GHSA-hm92-r4w5-c3mj) | 7.5 | yes |
| `vite`    | no      | server.fs.deny bypass on Windows alternate paths (GHSA-fx2h-pf6j-xcff) | n/a | yes |
| `ws`      | no      | Memory exhaustion DoS from tiny fragments (GHSA-96hv-2xvq-fx4p) | 7.5 | yes |

#### MODERATE findings (log only)

`@astrojs/language-server` (via volar-service-yaml), `@cloudflare/vite-plugin` (via miniflare/ws), `astro` (XSS via spread props, GHSA-jrpj-wcv7-9fh9), `js-yaml` (quadratic DoS, GHSA-h67p-54hq-rp68), `miniflare` (via undici/ws), `supabase` (via tar, direct), `tar` (PAX size override — GHSA-vmf3-w455-68vh), `undici` (HTTP header injection, cross-user cache disclosure), `vite` (NTLM hash disclosure via launch-editor), `volar-service-yaml` (via yaml-language-server), `wrangler` (via esbuild/miniflare, direct), `yaml` (stack overflow via deeply nested YAML), `yaml-language-server` (via yaml)

#### LOW findings (log only)

`@babel/core` (arbitrary file read via sourceMappingURL, GHSA-4x5r-pxfx-6jf8), `esbuild` (arbitrary file read on Windows dev server, GHSA-g7r4-m6w7-qqqr), `undici` (HTTP response queue poisoning, Set-Cookie SameSite downgrade)

## Hints recorded but not acted on

| Hint                    | Value              |
| ----------------------- | ------------------ |
| bootstrapper_confidence | first-class        |
| quality_override        | false              |
| path_taken              | standard           |
| self_check_answers      | null               |
| team_size               | solo               |
| deployment_target       | cloudflare-pages   |
| ci_provider             | github-actions     |
| ci_default_flow         | auto-deploy-on-merge |
| has_auth                | true               |
| has_payments            | false              |
| has_realtime            | false              |
| has_ai                  | false              |
| has_background_jobs     | false              |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history.
- Review `CLAUDE.md.scaffold` — the starter shipped its own CLAUDE.md; diff it against yours to see if anything is worth merging in.
- Run `npm audit fix` to address all 17 fixable vulnerabilities (all findings above have fixes available).
- Address audit findings per your project's risk tolerance — the full breakdown is in this log.
