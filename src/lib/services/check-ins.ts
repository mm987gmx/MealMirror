import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/database.types";
import type { CheckIn } from "@/types";

const POST_MEAL_CHECK_IN_DUE_MINUTES = 90;

type Client = SupabaseClient<Database>;

/** An "active" post-meal check-in is one still unresolved and not yet replaced by a defer. */
function activeCheckInQuery(supabase: Client, userId: string) {
  return supabase
    .from("check_ins")
    .select("*")
    .eq("user_id", userId)
    .eq("kind", "post_meal")
    .is("completed_at", null)
    .is("superseded_by", null);
}

export async function findActiveCheckIn(supabase: Client, userId: string): Promise<CheckIn | null> {
  const { data, error } = await activeCheckInQuery(supabase, userId)
    .order("due_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function scheduleCheckIn(supabase: Client, userId: string, mealId: string): Promise<CheckIn> {
  const dueAt = new Date(Date.now() + POST_MEAL_CHECK_IN_DUE_MINUTES * 60_000).toISOString();
  const { data, error } = await supabase
    .from("check_ins")
    .insert({ user_id: userId, meal_id: mealId, kind: "post_meal", due_at: dueAt })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deferCheckIn(
  supabase: Client,
  userId: string,
  activeCheckInId: string,
  mealId: string,
): Promise<CheckIn> {
  const { data, error } = await supabase.rpc("defer_check_in", {
    p_user_id: userId,
    p_active_check_in_id: activeCheckInId,
    p_meal_id: mealId,
  });
  if (error) throw error;
  return data;
}

export async function listDueCheckIns(supabase: Client, userId: string): Promise<CheckIn[]> {
  const nowIso = new Date().toISOString();
  const { data, error } = await activeCheckInQuery(supabase, userId).lte("due_at", nowIso).order("due_at", {
    ascending: true,
  });
  if (error) throw error;
  return data;
}

export interface CheckInSymptoms {
  stomachPain: boolean;
  heartburn: boolean;
  bloating: boolean;
  bowelIssues: boolean;
  generalWellbeing: boolean;
  dryMouth: boolean;
}

export async function completeCheckIn(
  supabase: Client,
  userId: string,
  checkInId: string,
  symptoms: CheckInSymptoms,
): Promise<CheckIn> {
  const { data, error } = await supabase
    .from("check_ins")
    .update({
      completed_at: new Date().toISOString(),
      stomach_pain: symptoms.stomachPain,
      heartburn: symptoms.heartburn,
      bloating: symptoms.bloating,
      bowel_issues: symptoms.bowelIssues,
      general_wellbeing: symptoms.generalWellbeing,
      dry_mouth: symptoms.dryMouth,
    })
    .eq("id", checkInId)
    .eq("user_id", userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}
