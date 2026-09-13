import { loadEnv } from "vite";
import { getViteConfig } from "astro/config";

// Vite loads .env.test for the astro:env/server virtual module (proven by
// env-smoke.test.ts) but does NOT mirror it into real process.env, which
// plain Node test-support code (e.g. the service-role key, which isn't part
// of astro's env schema) needs. Load it explicitly here, once, for every
// test file.
Object.assign(process.env, loadEnv("test", process.cwd(), ""));

export default getViteConfig({
  // @ts-expect-error -- astro's nested vite@8 and the hoisted vite@7 vitest augments (a
  // pre-existing @astrojs/cloudflare/vite-plugin peer-range skew) are distinct TS module
  // instances, so the `test` key vitest adds via declaration merging isn't visible here.
  // Harmless at runtime: Vitest reads `test` regardless of what astro's types know about.
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
