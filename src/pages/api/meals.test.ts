import { describe, expect, it } from "vitest";
import type { APIContext } from "astro";
import { POST } from "./meals";
import { buildFakeApiContext, buildSessionCookieHeader } from "@/lib/test-support/api-context";
import {
  createAdminClient,
  createTestUser,
  deleteTestUser,
  signInTestUser,
} from "@/lib/test-support/supabase-test-client";

const MEAL_RACE_MESSAGE = "Your pending check-in changed while you were logging this meal — please try again.";

function buildMealRequest(cookieHeader: string, description: string): Request {
  const formData = new FormData();
  formData.set("occurredAt", new Date().toISOString());
  formData.set("description", description);
  return new Request("http://localhost/api/meals", {
    method: "POST",
    body: formData,
    headers: { Cookie: cookieHeader },
  });
}

describe("POST /api/meals (concurrency)", () => {
  it("exactly one of two concurrent meal-creation requests wins when no collision exists", async () => {
    const admin = createAdminClient();
    const user = await createTestUser(admin);
    try {
      const cookieHeader = await buildSessionCookieHeader(user.email, user.password);

      const context1 = buildFakeApiContext({ request: buildMealRequest(cookieHeader, "oatmeal"), userId: user.id });
      const context2 = buildFakeApiContext({ request: buildMealRequest(cookieHeader, "salad"), userId: user.id });

      const [response1, response2] = await Promise.all([
        POST(context1 as unknown as APIContext),
        POST(context2 as unknown as APIContext),
      ]);
      const locations = [response1.headers.get("Location") ?? "", response2.headers.get("Location") ?? ""];

      const succeeded = locations.filter((loc) => loc === "/dashboard");
      const failed = locations.filter((loc) => loc.includes("error="));
      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(1);
      expect(decodeURIComponent(failed[0])).toContain(MEAL_RACE_MESSAGE);

      const supabase = await signInTestUser(user.email, user.password);
      const { data: activeCheckIns, error } = await supabase
        .from("check_ins")
        .select("*")
        .eq("user_id", user.id)
        .is("completed_at", null)
        .is("superseded_by", null);
      if (error) throw error;
      expect(activeCheckIns).toHaveLength(1);
    } finally {
      await deleteTestUser(admin, user.id);
    }
  });
});
