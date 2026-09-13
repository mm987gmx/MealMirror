import { getViteConfig } from "astro/config";

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
