import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { collisionResolutionSchema } from "@/lib/validation/meal-tracking";
import { resolveCollision } from "@/lib/services/meals";

export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  const form = await context.request.formData();
  const parsed = collisionResolutionSchema.safeParse({
    action: form.get("action") as string,
    pendingCheckInId: form.get("pendingCheckInId") as string,
    mealId: form.get("mealId") as string,
  });
  if (!parsed.success) {
    return context.redirect(`/dashboard?error=${encodeURIComponent(parsed.error.issues[0].message)}`);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/dashboard?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  try {
    await resolveCollision(supabase, user.id, parsed.data);
    return context.redirect("/dashboard");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to resolve collision";
    return context.redirect(`/dashboard?error=${encodeURIComponent(message)}`);
  }
};
