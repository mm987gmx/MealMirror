import { describe, expect, it } from "vitest";
import { createAdminClient, createTestUser, deleteTestUser, signInTestUser } from "@/lib/test-support/supabase-test-client";
import { scheduleCheckIn } from "./check-ins";

describe("defer_check_in RPC (direct)", () => {
  it("atomically supersedes the old check-in and activates a new one for the second meal", async () => {
    const admin = createAdminClient();
    const user = await createTestUser(admin);
    try {
      const supabase = await signInTestUser(user.email, user.password);

      const { data: meal1, error: meal1Error } = await supabase
        .from("meals")
        .insert({ user_id: user.id, occurred_at: new Date().toISOString(), description: "oatmeal" })
        .select()
        .single();
      if (meal1Error) throw meal1Error;
      const checkIn1 = await scheduleCheckIn(supabase, user.id, meal1.id);

      const { data: meal2, error: meal2Error } = await supabase
        .from("meals")
        .insert({ user_id: user.id, occurred_at: new Date().toISOString(), description: "salad" })
        .select()
        .single();
      if (meal2Error) throw meal2Error;

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
