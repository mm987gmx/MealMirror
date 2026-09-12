import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { mealInputSchema } from "@/lib/validation/meal-tracking";
import { createMealWithCheckIn } from "@/lib/services/meals";
import { isUniqueViolation } from "@/lib/services/postgres-errors";

export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  const form = await context.request.formData();
  const parsed = mealInputSchema.safeParse({
    occurredAt: form.get("occurredAt") as string,
    description: form.get("description") as string,
  });
  if (!parsed.success) {
    return context.redirect(`/dashboard?error=${encodeURIComponent(parsed.error.issues[0].message)}`);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/dashboard?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  try {
    const { meal, collision } = await createMealWithCheckIn(supabase, user.id, parsed.data);
    if (collision) {
      return context.redirect(`/dashboard?collision=${collision.id}&meal=${meal.id}`);
    }
    return context.redirect("/dashboard");
  } catch (err) {
    const message = isUniqueViolation(err)
      ? "Your pending check-in changed while you were logging this meal — please try again."
      : err instanceof Error
        ? err.message
        : "Failed to log meal";
    return context.redirect(`/dashboard?error=${encodeURIComponent(message)}`);
  }
};
