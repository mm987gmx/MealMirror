import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/database.types";
import {
  createAdminClient,
  createTestUser,
  deleteTestUser,
  signInTestUser,
} from "@/lib/test-support/supabase-test-client";
import { deferCheckIn, scheduleCheckIn } from "./check-ins";
import { isDeferConflict } from "./postgres-errors";

const admin = createAdminClient();

async function withTestUser(run: (supabase: SupabaseClient<Database>, userId: string) => Promise<void>): Promise<void> {
  const user = await createTestUser(admin);
  try {
    const supabase = await signInTestUser(user.email, user.password);
    await run(supabase, user.id);
  } finally {
    await deleteTestUser(admin, user.id);
  }
}

async function logMeal(supabase: SupabaseClient<Database>, userId: string, description: string) {
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
    await withTestUser(async (supabase, userId) => {
      const meal1 = await logMeal(supabase, userId, "oatmeal");
      const checkIn1 = await scheduleCheckIn(supabase, userId, meal1.id);
      const meal2 = await logMeal(supabase, userId, "salad");

      const { data: result, error } = await supabase.rpc("defer_check_in", {
        p_user_id: userId,
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
    });
  });
});

describe("deferCheckIn (sequential)", () => {
  it("succeeds for an ordinary, non-concurrent defer call (previously failed every time)", async () => {
    await withTestUser(async (supabase, userId) => {
      const meal1 = await logMeal(supabase, userId, "oatmeal");
      const checkIn1 = await scheduleCheckIn(supabase, userId, meal1.id);
      const meal2 = await logMeal(supabase, userId, "salad");

      const newCheckIn = await deferCheckIn(supabase, userId, checkIn1.id, meal2.id);
      expect(newCheckIn.meal_id).toBe(meal2.id);
      expect(newCheckIn.superseded_by).toBeNull();

      const { data: oldCheckIn, error: oldErr } = await supabase
        .from("check_ins")
        .select("*")
        .eq("id", checkIn1.id)
        .single();
      if (oldErr) throw oldErr;
      expect(oldCheckIn.superseded_by).toBe(newCheckIn.id);
    });
  });
});

describe("deferCheckIn (concurrency)", () => {
  it.each([1, 2, 3])("run %i: exactly one of two concurrent defers against the same check-in wins", async () => {
    await withTestUser(async (supabase, userId) => {
      const meal1 = await logMeal(supabase, userId, "oatmeal");
      const checkIn1 = await scheduleCheckIn(supabase, userId, meal1.id);
      const meal2 = await logMeal(supabase, userId, "salad");
      const meal3 = await logMeal(supabase, userId, "soup");

      const results = await Promise.allSettled([
        deferCheckIn(supabase, userId, checkIn1.id, meal2.id),
        deferCheckIn(supabase, userId, checkIn1.id, meal3.id),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(isDeferConflict(rejected[0].reason)).toBe(true);

      const { data: activeCheckIns, error: activeErr } = await supabase
        .from("check_ins")
        .select("*")
        .eq("user_id", userId)
        .is("completed_at", null)
        .is("superseded_by", null);
      if (activeErr) throw activeErr;
      expect(activeCheckIns).toHaveLength(1);
    });
  });
});
