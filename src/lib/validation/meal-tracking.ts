import { z } from "zod";

// `datetime-local` inputs produce values like "2026-09-12T14:30" — no timezone,
// no seconds — which z.string().datetime() rejects. Validate via Date.parse instead.
const isoLikeDateTime = z
  .string()
  .min(1, "Date and time are required")
  .refine((value) => !isNaN(Date.parse(value)), "Enter a valid date and time");

export const mealInputSchema = z.object({
  occurredAt: isoLikeDateTime,
  description: z.string().trim().min(1, "Description is required").max(2000, "Description is too long"),
});

export type MealInput = z.infer<typeof mealInputSchema>;

export const collisionResolutionSchema = z.object({
  action: z.enum(["keep", "defer"]),
  pendingCheckInId: z.uuid(),
  mealId: z.uuid(),
});

export type CollisionResolutionInput = z.infer<typeof collisionResolutionSchema>;

export const checkInCompletionSchema = z.object({
  checkInId: z.uuid(),
  stomachPain: z.boolean(),
  heartburn: z.boolean(),
  bloating: z.boolean(),
  bowelIssues: z.boolean(),
  generalWellbeing: z.boolean(),
  dryMouth: z.boolean(),
});

export type CheckInCompletionInput = z.infer<typeof checkInCompletionSchema>;
