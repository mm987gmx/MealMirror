import { describe, expect, it } from "vitest";
import type { APIContext } from "astro";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/database.types";
import { POST } from "./collision";
import { createMealWithCheckIn } from "@/lib/services/meals";
import { buildFakeApiContext, buildSessionCookieHeader } from "@/lib/test-support/api-context";
import {
  createAdminClient,
  createTestUser,
  deleteTestUser,
  signInTestUser,
} from "@/lib/test-support/supabase-test-client";

const DEFER_CONFLICT_MESSAGE = "This check-in was already resolved elsewhere — please refresh and try again.";

function assertDefined<T>(value: T | null | undefined, message: string): asserts value is T {
  if (value === null || value === undefined) throw new Error(message);
}

async function setUpCollision(supabase: SupabaseClient<Database>, userId: string) {
  await createMealWithCheckIn(supabase, userId, { occurredAt: new Date().toISOString(), description: "oatmeal" });
  const { meal, collision } = await createMealWithCheckIn(supabase, userId, {
    occurredAt: new Date().toISOString(),
    description: "salad",
  });
  assertDefined(collision, "expected the second meal to collide with the first's pending check-in");
  return { pendingCheckInId: collision.id, mealId: meal.id };
}

function buildDeferRequest(cookieHeader: string, pendingCheckInId: string, mealId: string): Request {
  const formData = new FormData();
  formData.set("action", "defer");
  formData.set("pendingCheckInId", pendingCheckInId);
  formData.set("mealId", mealId);
  return new Request("http://localhost/api/check-ins/collision", {
    method: "POST",
    body: formData,
    headers: { Cookie: cookieHeader },
  });
}

describe("POST /api/check-ins/collision (concurrency)", () => {
  it("exactly one of two concurrent defer requests against the same check-in wins", async () => {
    const admin = createAdminClient();
    const user = await createTestUser(admin);
    try {
      const supabase = await signInTestUser(user.email, user.password);
      const { pendingCheckInId, mealId } = await setUpCollision(supabase, user.id);
      const cookieHeader = await buildSessionCookieHeader(user.email, user.password);

      const context1 = buildFakeApiContext({
        request: buildDeferRequest(cookieHeader, pendingCheckInId, mealId),
        userId: user.id,
      });
      const context2 = buildFakeApiContext({
        request: buildDeferRequest(cookieHeader, pendingCheckInId, mealId),
        userId: user.id,
      });

      const [response1, response2] = await Promise.all([
        POST(context1 as unknown as APIContext),
        POST(context2 as unknown as APIContext),
      ]);
      const locations = [response1.headers.get("Location") ?? "", response2.headers.get("Location") ?? ""];

      const succeeded = locations.filter((loc) => loc === "/dashboard");
      const failed = locations.filter((loc) => loc.includes("error="));
      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(1);
      expect(decodeURIComponent(failed[0])).toContain(DEFER_CONFLICT_MESSAGE);

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

describe("POST /api/check-ins/collision (sequential)", () => {
  it("succeeds for a single, non-concurrent defer request", async () => {
    const admin = createAdminClient();
    const user = await createTestUser(admin);
    try {
      const supabase = await signInTestUser(user.email, user.password);
      const { pendingCheckInId, mealId } = await setUpCollision(supabase, user.id);
      const cookieHeader = await buildSessionCookieHeader(user.email, user.password);

      const context = buildFakeApiContext({
        request: buildDeferRequest(cookieHeader, pendingCheckInId, mealId),
        userId: user.id,
      });
      const response = await POST(context as unknown as APIContext);
      expect(response.headers.get("Location")).toBe("/dashboard");
    } finally {
      await deleteTestUser(admin, user.id);
    }
  });
});
