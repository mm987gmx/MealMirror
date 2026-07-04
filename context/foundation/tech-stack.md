---
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
---

## Why this stack

MealMirror is a solo-built, after-hours health-tracking web app with a 4-week MVP window, auth as the only technology-forcing feature, and no payments, realtime, or background jobs in scope. The 10x Astro Starter (Astro 6 + React 19 + TypeScript + Tailwind 4 + Supabase + Cloudflare Pages) is the recommended default for the (web-app, js) cell and fits all load-bearing constraints: Supabase ships PostgreSQL and auth out of the box, removing the most common greenfield integration risk; TypeScript end-to-end with Zod schemas aligns with the project's emphasis on reliable structured data capture; Cloudflare Pages is the starter's native deployment target, minimising configuration overhead. All four agent-friendly gates pass — typed, convention-based, popular in training data, well-documented. Solo build with a short timeline favours battle-tested and popular-community starters; this stack delivers both. Bootstrapper confidence is first-class.
