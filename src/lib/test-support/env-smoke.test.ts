import { describe, expect, it } from "vitest";
import { SUPABASE_URL, SUPABASE_KEY } from "astro:env/server";

describe("test environment", () => {
  it("loads Supabase env vars from .env.test under Vitest", () => {
    expect(typeof SUPABASE_URL).toBe("string");
    expect(SUPABASE_URL).not.toBe("");
    expect(typeof SUPABASE_KEY).toBe("string");
    expect(SUPABASE_KEY).not.toBe("");
  });
});
