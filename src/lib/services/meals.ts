import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/database.types";
import type { Meal, CheckIn } from "@/types";
import { findActiveCheckIn, scheduleCheckIn, deferCheckIn } from "./check-ins";
import type { CollisionResolutionInput } from "@/lib/validation/meal-tracking";

type Client = SupabaseClient<Database>;

export interface MealInput {
  occurredAt: string;
  description: string;
}

export async function createMealWithCheckIn(
  supabase: Client,
  userId: string,
  input: MealInput,
): Promise<{ meal: Meal; collision: CheckIn | null }> {
  const { data: meal, error } = await supabase
    .from("meals")
    .insert({ user_id: userId, occurred_at: new Date(input.occurredAt).toISOString(), description: input.description })
    .select()
    .single();
  if (error) throw error;

  const activeCheckIn = await findActiveCheckIn(supabase, userId);
  if (activeCheckIn) {
    return { meal, collision: activeCheckIn };
  }

  await scheduleCheckIn(supabase, userId, meal.id);
  return { meal, collision: null };
}

export async function resolveCollision(
  supabase: Client,
  userId: string,
  input: CollisionResolutionInput,
): Promise<void> {
  if (input.action === "defer") {
    await deferCheckIn(supabase, userId, input.pendingCheckInId, input.mealId);
  }
  // "keep" is a no-op: the second meal gets no check-in of its own.
}
