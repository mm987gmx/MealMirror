---
change_id: meal-crud-completion
title: Meal CRUD completion
status: implemented
created: 2026-09-13
updated: 2026-09-13
archived_at: null
---

## Notes

Closed the gap between the check-in engine and the meal record itself. Before
this change a meal could only be created — once logged it was invisible in the
UI and could not be corrected or removed, which made an ordinary typo
permanent and left the user no way to undo a mis-logged meal.

### What shipped

- `listMeals`, `updateMeal`, `deleteMeal` in `src/lib/services/meals.ts`, all
  scoped by `user_id` on top of the existing RLS policies.
- `POST /api/meals/:id` dispatching on an `intent` field (`update` / `delete`).
  Forms can only issue GET and POST, and the UI is deliberately plain-form
  based, so verbs go in the body rather than the method.
- `MealList` island on the dashboard: meals newest-first, each tagged with its
  check-in status (`pending` / `completed` / `deferred` / `none`), inline edit,
  delete behind a confirm.

### Decisions worth remembering

- **Editing a meal does not reschedule its check-in.** The 90-minute window is
  anchored to when the meal was *logged*, not to `occurred_at` (see
  `scheduleCheckIn`), so letting an edit move the due time would be a way to
  dodge a check-in that is already due.
- **Deleting a meal cascades its check-ins away.** Already the schema's
  behaviour via `on delete cascade`; adopted deliberately rather than worked
  around, since a symptom answer is meaningless without the meal it describes.
- **Check-ins get no standalone create/delete.** They exist only as a
  consequence of a meal; exposing them directly would let the two tables drift
  apart.

### Timezone bug found and fixed on the way

Surfacing `occurred_at` in the UI exposed a pre-existing defect. A
`datetime-local` input submits a wall-clock string with no offset, and the
server runs in UTC, so `new Date(value)` read the user's local time as UTC —
shifting every meal by the user's offset, and shifting it again on every edit
because the edit form round-tripped the already-shifted value. Conversion now
happens in the browser, where the offset is known (`src/lib/datetime.ts`),
with a round-trip test that specifically covers the compounding case.

### Coverage added

`src/lib/services/meals.test.ts` gained list/update/delete cases plus a
two-user test proving an authenticated user cannot update or delete another
user's meal even when handed the row ID — the cheapest available coverage for
test-plan Risk #6.

Separately, the concurrency test in `src/pages/api/meals.test.ts` was flaky: it
asserted that the losing request always fails on the unique-index race, but
depending on interleaving the loser can legitimately read the winner's
check-in and land on the collision prompt instead. It now accepts either
outcome while keeping the hard assertion that exactly one active check-in
survives.
