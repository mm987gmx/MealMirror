import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { checkInCompletionSchema } from "@/lib/validation/meal-tracking";
import { completeCheckIn } from "@/lib/services/check-ins";

export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  const form = await context.request.formData();
  // Unchecked checkboxes are absent from FormData entirely — presence, not value, means true.
  const parsed = checkInCompletionSchema.safeParse({
    checkInId: form.get("checkInId") as string,
    stomachPain: form.has("stomachPain"),
    heartburn: form.has("heartburn"),
    bloating: form.has("bloating"),
    bowelIssues: form.has("bowelIssues"),
    generalWellbeing: form.has("generalWellbeing"),
    dryMouth: form.has("dryMouth"),
  });
  if (!parsed.success) {
    return context.redirect(`/dashboard?error=${encodeURIComponent(parsed.error.issues[0].message)}`);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/dashboard?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  try {
    const { checkInId, ...symptoms } = parsed.data;
    await completeCheckIn(supabase, user.id, checkInId, symptoms);
    return context.redirect("/dashboard");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to complete check-in";
    return context.redirect(`/dashboard?error=${encodeURIComponent(message)}`);
  }
};
