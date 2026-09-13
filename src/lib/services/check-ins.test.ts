import { describe, expect, it } from "vitest";
import {
  createAdminClient,
  createTestUser,
  deleteTestUser,
  signInTestUser,
} from "@/lib/test-support/supabase-test-client";
import { deferCheckIn, scheduleCheckIn } from "./check-ins";
import { isDeferConflict } from "./postgres-errors";

async function logMeal(supabase: Awaited<ReturnType<typeof signInTestUser>>, userId: string, description: string) {
  const { data, error } = await supabase
    .from("meals")
    .insert({ user_id: userId, occurred_at: new Date().toISOString(), description })
    .select()
    .single();
  if (error) throw error;
  return data;
}

describe("defer_check_in RPC (direct)", () => {
  it("atomically supersedes the old check-in and activates a new one for the second meal", async () => {
    const admin = createAdminClient();
    const user = await createTestUser(admin);
    try {
      const supabase = await signInTestUser(user.email, user.password);

      const meal1 = await logMeal(supabase, user.id, "oatmeal");
      const checkIn1 = await scheduleCheckIn(supabase, user.id, meal1.id);
      const meal2 = await logMeal(supabase, user.id, "salad");

      const { data: result, error } = await supabase.rpc("defer_check_in", {
        p_user_id: user.id,
        p_active_check_in_id: checkIn1.id,
        p_meal_id: meal2.id,
      });
      expect(error).toBeNull();
      expect(result).not.toBeNull();
      expect(result?.meal_id).toBe(meal2.id);

      const { data: oldCheckIn, error: oldErr } = await supabase
        .from("check_ins")
        .select("*")
        .eq("id", checkIn1.id)
        .single();
      if (oldErr) throw oldErr;
      expect(oldCheckIn.superseded_by).toBe(result?.id);
    } finally {
      await deleteTestUser(admin, user.id);
    }
  });
});

describe("deferCheckIn (sequential)", () => {
  it("succeeds for an ordinary, non-concurrent defer call (previously failed every time)", async () => {
    const admin = createAdminClient();
    const user = await createTestUser(admin);
    try {
      const supabase = await signInTestUser(user.email, user.password);

      const meal1 = await logMeal(supabase, user.id, "oatmeal");
      const checkIn1 = await scheduleCheckIn(supabase, user.id, meal1.id);
      const meal2 = await logMeal(supabase, user.id, "salad");

      const newCheckIn = await deferCheckIn(supabase, user.id, checkIn1.id, meal2.id);
      expect(newCheckIn.meal_id).toBe(meal2.id);
      expect(newCheckIn.superseded_by).toBeNull();

      const { data: oldCheckIn, error: oldErr } = await supabase
        .from("check_ins")
        .select("*")
        .eq("id", checkIn1.id)
        .single();
      if (oldErr) throw oldErr;
      expect(oldCheckIn.superseded_by).toBe(newCheckIn.id);
    } finally {
      await deleteTestUser(admin, user.id);
    }
  });
});

describe("deferCheckIn (concurrency)", () => {
  it.each([1, 2, 3])("run %i: exactly one of two concurrent defers against the same check-in wins", async () => {
    const admin = createAdminClient();
    const user = await createTestUser(admin);
    try {
      const supabase = await signInTestUser(user.email, user.password);

      const meal1 = await logMeal(supabase, user.id, "oatmeal");
      const checkIn1 = await scheduleCheckIn(supabase, user.id, meal1.id);
      const meal2 = await logMeal(supabase, user.id, "salad");
      const meal3 = await logMeal(supabase, user.id, "soup");

      const results = await Promise.allSettled([
        deferCheckIn(supabase, user.id, checkIn1.id, meal2.id),
        deferCheckIn(supabase, user.id, checkIn1.id, meal3.id),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(isDeferConflict(rejected[0].reason)).toBe(true);

      const { data: activeCheckIns, error: activeErr } = await supabase
        .from("check_ins")
        .select("*")
        .eq("user_id", user.id)
        .is("completed_at", null)
        .is("superseded_by", null);
      if (activeErr) throw activeErr;
      expect(activeCheckIns).toHaveLength(1);
    } finally {
      await deleteTestUser(admin, user.id);
    }
  });
});
