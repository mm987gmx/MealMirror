import { describe, expect, it } from "vitest";
import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import type { Database } from "@/database.types";
import { createAdminClient, createTestUser, deleteTestUser } from "./supabase-test-client";
import { buildSessionCookieHeader } from "./api-context";

describe("buildSessionCookieHeader", () => {
  it("authenticates a real @supabase/ssr server client, mirroring src/lib/supabase.ts", async () => {
    const admin = createAdminClient();
    const user = await createTestUser(admin);

    try {
      const cookieHeader = await buildSessionCookieHeader(user.email, user.password);

      const supabase = createServerClient<Database>(process.env.SUPABASE_URL ?? "", process.env.SUPABASE_KEY ?? "", {
        cookies: {
          getAll: () => parseCookieHeader(cookieHeader).map(({ name, value }) => ({ name, value: value ?? "" })),
          setAll: () => undefined,
        },
      });

      const { data, error } = await supabase.auth.getUser();
      expect(error).toBeNull();
      expect(data.user?.id).toBe(user.id);
    } finally {
      await deleteTestUser(admin, user.id);
    }
  });
});
