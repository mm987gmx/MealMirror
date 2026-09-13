import type { APIContext, APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { mealIdSchema, mealUpdateSchema } from "@/lib/validation/meal-tracking";
import { deleteMeal, updateMeal } from "@/lib/services/meals";

function backToDashboard(context: APIContext, params: Record<string, string>): Response {
  const query = new URLSearchParams(params).toString();
  return context.redirect(query ? `/dashboard?${query}` : "/dashboard");
}

// HTML forms can only issue GET and POST, and the rest of the app is built on
// plain form posts so it keeps working without JS — so edit and delete are
// dispatched from a hidden `intent` field rather than PATCH/DELETE verbs.
export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return backToDashboard(context, { error: "Supabase is not configured" });
  }

  const form = await context.request.formData();
  const intent = form.get("intent");
  const mealId = context.params.id ?? "";

  try {
    if (intent === "delete") {
      const parsed = mealIdSchema.safeParse({ mealId });
      if (!parsed.success) {
        return backToDashboard(context, { error: parsed.error.issues[0].message });
      }
      await deleteMeal(supabase, user.id, parsed.data.mealId);
      return backToDashboard(context, { notice: "Meal deleted." });
    }

    if (intent === "update") {
      const parsed = mealUpdateSchema.safeParse({
        mealId,
        occurredAt: form.get("occurredAt") as string,
        description: form.get("description") as string,
      });
      if (!parsed.success) {
        return backToDashboard(context, { error: parsed.error.issues[0].message });
      }
      await updateMeal(supabase, user.id, parsed.data);
      return backToDashboard(context, { notice: "Meal updated." });
    }

    return backToDashboard(context, { error: "Unknown action" });
  } catch (err) {
    return backToDashboard(context, { error: err instanceof Error ? err.message : "Failed to change this meal" });
  }
};
