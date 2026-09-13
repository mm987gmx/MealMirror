import { defineConfig, devices } from "@playwright/test";

// The test files themselves (createAdminClient, buildSessionCookies) run in
// Playwright's own process and need SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY
// from .env.test — separate from the served app, which gets its own vars
// from dist/server/.dev.vars via wrangler dev.
process.loadEnvFile(".env.test");

export default defineConfig({
  testDir: "./e2e",
  reporter: "list",
  use: {
    baseURL: "http://localhost:4321",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // `astro dev`'s Cloudflare Workers dev-mode integration currently crashes
    // in this environment ("Missing field 'moduleType'", an astro /
    // @astrojs/cloudflare / workerd version-skew issue unrelated to this
    // test) — build + `wrangler dev` against the static output is the
    // proven-working path. `.dev.vars` is copied into dist/server/ by the
    // build and already carries the local Supabase values wrangler dev needs.
    command: "npm run build && npx wrangler dev -c dist/server/wrangler.json --port 4321",
    url: "http://localhost:4321",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
