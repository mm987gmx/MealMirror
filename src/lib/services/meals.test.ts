import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/database.types";
import { createMealWithCheckIn, deleteMeal, listMeals, resolveCollision, updateMeal } from "./meals";
import {
  createAdminClient,
  createTestUser,
  deleteTestUser,
  signInTestUser,
} from "@/lib/test-support/supabase-test-client";

const admin = createAdminClient();

function assertDefined<T>(value: T | null | undefined, message: string): asserts value is T {
  if (value === null || value === undefined) throw new Error(message);
}

async function withTestUser(run: (supabase: SupabaseClient<Database>, userId: string) => Promise<void>): Promise<void> {
  const user = await createTestUser(admin);
  try {
    const supabase = await signInTestUser(user.email, user.password);
    await run(supabase, user.id);
  } finally {
    await deleteTestUser(admin, user.id);
  }
}

interface SignedInUser {
  supabase: SupabaseClient<Database>;
  userId: string;
}

/** Two isolated signed-in users, for proving one cannot reach the other's data. */
async function withTwoTestUsers(run: (a: SignedInUser, b: SignedInUser) => Promise<void>): Promise<void> {
  const userA = await createTestUser(admin);
  const userB = await createTestUser(admin);
  try {
    const supabaseA = await signInTestUser(userA.email, userA.password);
    const supabaseB = await signInTestUser(userB.email, userB.password);
    await run({ supabase: supabaseA, userId: userA.id }, { supabase: supabaseB, userId: userB.id });
  } finally {
    await deleteTestUser(admin, userA.id);
    await deleteTestUser(admin, userB.id);
  }
}

async function getCheckIns(supabase: SupabaseClient<Database>, userId: string) {
  const { data, error } = await supabase
    .from("check_ins")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

function logMeal(supabase: SupabaseClient<Database>, userId: string, description: string) {
  return createMealWithCheckIn(supabase, userId, { occurredAt: new Date().toISOString(), description });
}

describe("collision/defer chain", () => {
  it("one meal, no prior check-in: no collision, one active check-in", async () => {
    await withTestUser(async (supabase, userId) => {
      const { meal, collision } = await logMeal(supabase, userId, "oatmeal");
      expect(collision).toBeNull();

      const checkIns = await getCheckIns(supabase, userId);
      expect(checkIns).toHaveLength(1);
      expect(checkIns[0].meal_id).toBe(meal.id);
      expect(checkIns[0].completed_at).toBeNull();
      expect(checkIns[0].superseded_by).toBeNull();
    });
  });

  it("two meals, keep: exactly one active check-in, the second meal gets none", async () => {
    await withTestUser(async (supabase, userId) => {
      const { meal: meal1 } = await logMeal(supabase, userId, "oatmeal");
      const { meal: meal2, collision } = await logMeal(supabase, userId, "salad");
      assertDefined(collision, "expected the second meal to collide with the first's pending check-in");

      await resolveCollision(supabase, userId, { action: "keep", pendingCheckInId: collision.id, mealId: meal2.id });

      const checkIns = await getCheckIns(supabase, userId);
      expect(checkIns).toHaveLength(1);
      expect(checkIns[0].meal_id).toBe(meal1.id);
      expect(checkIns[0].superseded_by).toBeNull();
      expect(checkIns[0].completed_at).toBeNull();
    });
  });

  it("two meals, defer: original superseded, new check-in active and tied to the second meal", async () => {
    await withTestUser(async (supabase, userId) => {
      const { meal: meal1 } = await logMeal(supabase, userId, "oatmeal");
      const { meal: meal2, collision } = await logMeal(supabase, userId, "salad");
      assertDefined(collision, "expected the second meal to collide with the first's pending check-in");

      await resolveCollision(supabase, userId, { action: "defer", pendingCheckInId: collision.id, mealId: meal2.id });

      const checkIns = await getCheckIns(supabase, userId);
      expect(checkIns).toHaveLength(2);

      const checkin1 = checkIns.find((c) => c.meal_id === meal1.id);
      const checkin2 = checkIns.find((c) => c.meal_id === meal2.id);
      assertDefined(checkin1, "expected a check-in tied to the first meal");
      assertDefined(checkin2, "expected a check-in tied to the second meal");

      expect(checkin1.superseded_by).toBe(checkin2.id);
      expect(checkin2.superseded_by).toBeNull();
      expect(checkin2.completed_at).toBeNull();
    });
  });

  it("documents: a 3-meal defer chain leaves earlier meals with no completable check-in (known gap, see research.md)", async () => {
    await withTestUser(async (supabase, userId) => {
      const { meal: meal1 } = await logMeal(supabase, userId, "oatmeal");

      const { meal: meal2, collision: collision1 } = await logMeal(supabase, userId, "salad");
      assertDefined(collision1, "expected the second meal to collide with the first's pending check-in");
      await resolveCollision(supabase, userId, {
        action: "defer",
        pendingCheckInId: collision1.id,
        mealId: meal2.id,
      });

      const { meal: meal3, collision: collision2 } = await logMeal(supabase, userId, "soup");
      assertDefined(collision2, "expected the third meal to collide with the deferred check-in from the second meal");
      await resolveCollision(supabase, userId, {
        action: "defer",
        pendingCheckInId: collision2.id,
        mealId: meal3.id,
      });

      const checkIns = await getCheckIns(supabase, userId);
      expect(checkIns).toHaveLength(3);

      const checkin1 = checkIns.find((c) => c.meal_id === meal1.id);
      const checkin2 = checkIns.find((c) => c.meal_id === meal2.id);
      const checkin3 = checkIns.find((c) => c.meal_id === meal3.id);
      assertDefined(checkin1, "expected a check-in tied to the first meal");
      assertDefined(checkin2, "expected a check-in tied to the second meal");
      assertDefined(checkin3, "expected a check-in tied to the third meal");

      expect(checkin1.superseded_by).toBe(checkin2.id);
      expect(checkin2.superseded_by).toBe(checkin3.id);
      expect(checkin3.superseded_by).toBeNull();
      expect(checkin3.completed_at).toBeNull();

      // Known gap (research.md Open Questions #1): superseded_by is never read
      // or traversed anywhere in the codebase, so checkin1 and checkin2 are
      // permanently excluded from findActiveCheckIn and can never be
      // completed — meal1's and meal2's symptom data can never be captured
      // under current behavior. Asserted here as a characterization of
      // current behavior, not as a spec the team has decided is correct.
      expect(checkin1.completed_at).toBeNull();
      expect(checkin2.completed_at).toBeNull();
    });
  });
});

describe("meal read/update/delete", () => {
  it("lists a user's meals newest-first, each tagged with its check-in status", async () => {
    await withTestUser(async (supabase, userId) => {
      const { meal: meal1 } = await logMeal(supabase, userId, "oatmeal");
      const { meal: meal2, collision } = await logMeal(supabase, userId, "salad");
      assertDefined(collision, "expected the second meal to collide with the first's pending check-in");
      await resolveCollision(supabase, userId, { action: "keep", pendingCheckInId: collision.id, mealId: meal2.id });

      const entries = await listMeals(supabase, userId);
      expect(entries.map((entry) => entry.meal.id)).toEqual([meal2.id, meal1.id]);
      expect(entries[0].checkInStatus).toBe("none");
      expect(entries[1].checkInStatus).toBe("pending");
    });
  });

  it("updates a meal without moving its pending check-in's due time", async () => {
    await withTestUser(async (supabase, userId) => {
      const { meal } = await logMeal(supabase, userId, "oatmeal");
      const [checkInBefore] = await getCheckIns(supabase, userId);

      const movedBackAnHour = new Date(Date.now() - 60 * 60_000).toISOString();
      const updated = await updateMeal(supabase, userId, {
        mealId: meal.id,
        occurredAt: movedBackAnHour,
        description: "oatmeal with berries",
      });

      expect(updated.description).toBe("oatmeal with berries");
      expect(new Date(updated.occurred_at).toISOString()).toBe(movedBackAnHour);

      const [checkInAfter] = await getCheckIns(supabase, userId);
      expect(checkInAfter.due_at).toBe(checkInBefore.due_at);
    });
  });

  it("deletes a meal and cascades its check-in away with it", async () => {
    await withTestUser(async (supabase, userId) => {
      const { meal } = await logMeal(supabase, userId, "oatmeal");
      expect(await getCheckIns(supabase, userId)).toHaveLength(1);

      await deleteMeal(supabase, userId, meal.id);

      expect(await listMeals(supabase, userId)).toHaveLength(0);
      expect(await getCheckIns(supabase, userId)).toHaveLength(0);
    });
  });

  it("does not let one user update or delete another user's meal (test-plan.md Risk #6)", async () => {
    await withTwoTestUsers(async (owner, intruder) => {
      const { meal } = await logMeal(owner.supabase, owner.userId, "oatmeal");

      // The intruder knows the ID and is authenticated — only ownership scoping stands in the way.
      await expect(deleteMeal(intruder.supabase, intruder.userId, meal.id)).rejects.toThrow();
      await expect(
        updateMeal(intruder.supabase, intruder.userId, {
          mealId: meal.id,
          occurredAt: new Date().toISOString(),
          description: "tampered",
        }),
      ).rejects.toThrow();

      const entries = await listMeals(owner.supabase, owner.userId);
      expect(entries).toHaveLength(1);
      expect(entries[0].meal.description).toBe("oatmeal");
      expect(await listMeals(intruder.supabase, intruder.userId)).toHaveLength(0);
    });
  });
});
