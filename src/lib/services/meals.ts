import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/database.types";
import type { Meal, CheckIn } from "@/types";
import { findActiveCheckIn, scheduleCheckIn, deferCheckIn } from "./check-ins";
import type { CollisionResolutionInput, MealUpdateInput } from "@/lib/validation/meal-tracking";

type Client = SupabaseClient<Database>;

const MEAL_LIST_LIMIT = 25;

export interface MealInput {
  occurredAt: string;
  description: string;
}

/**
 * Where a meal stands in the check-in loop:
 * - `pending` — its check-in is still open and answerable
 * - `completed` — its check-in was answered
 * - `deferred` — its check-in was superseded by a later meal's (see resolveCollision)
 * - `none` — no check-in was ever scheduled (the "keep" side of a collision)
 */
export type MealCheckInStatus = "pending" | "completed" | "deferred" | "none";

export interface MealListEntry {
  meal: Meal;
  checkInStatus: MealCheckInStatus;
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

export async function listMeals(supabase: Client, userId: string, limit = MEAL_LIST_LIMIT): Promise<MealListEntry[]> {
  const { data: meals, error } = await supabase
    .from("meals")
    .select("*")
    .eq("user_id", userId)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  if (meals.length === 0) return [];

  const { data: checkIns, error: checkInError } = await supabase
    .from("check_ins")
    .select("meal_id, completed_at, superseded_by")
    .eq("user_id", userId)
    .in(
      "meal_id",
      meals.map((meal) => meal.id),
    );
  if (checkInError) throw checkInError;

  const statusByMealId = new Map<string, MealCheckInStatus>();
  for (const checkIn of checkIns) {
    if (!checkIn.meal_id) continue;
    const status: MealCheckInStatus = checkIn.completed_at
      ? "completed"
      : checkIn.superseded_by
        ? "deferred"
        : "pending";
    // A completed check-in is the strongest signal, so it never loses to a
    // superseded sibling left behind by an earlier defer.
    if (statusByMealId.get(checkIn.meal_id) === "completed") continue;
    statusByMealId.set(checkIn.meal_id, status);
  }

  return meals.map((meal) => ({ meal, checkInStatus: statusByMealId.get(meal.id) ?? "none" }));
}

/**
 * Edits a meal's time and description. The linked check-in keeps its original
 * due time on purpose: the 90-minute window is anchored to when the meal was
 * logged, so letting an edit move it would be a way to dodge a check-in that
 * is already due.
 */
export async function updateMeal(supabase: Client, userId: string, input: MealUpdateInput): Promise<Meal> {
  const { data, error } = await supabase
    .from("meals")
    .update({ occurred_at: new Date(input.occurredAt).toISOString(), description: input.description })
    .eq("id", input.mealId)
    .eq("user_id", userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Deletes a meal. Its check-ins go with it via `on delete cascade`, which is
 * the intended behaviour: a symptom answer is meaningless once the meal it
 * describes is gone.
 */
export async function deleteMeal(supabase: Client, userId: string, mealId: string): Promise<void> {
  const { data, error } = await supabase
    .from("meals")
    .delete()
    .eq("id", mealId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Meal not found");
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
