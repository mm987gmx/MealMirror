---
change_id: fix-defer-checkin-race
title: Fix deferCheckIn violating the single-active-check-in invariant
status: impl_reviewed
created: 2026-09-13
updated: 2026-09-13
archived_at: null
---

## Notes

Discovered while writing Phase 1 tests for `context/foundation/test-plan.md`
(change `testing-collision-invariant-coverage`, Phase 3). Every call to
`deferCheckIn` (`src/lib/services/check-ins.ts:40-54`) currently fails with
`duplicate key value violates unique constraint "check_ins_one_active_per_user"`
— not just under concurrency, but on ordinary sequential, single-user use.

Root cause: `deferCheckIn` inserts the new active check-in (`scheduleCheckIn`)
*before* updating the old check-in's `superseded_by`. For that window, two
rows are simultaneously "active" for the same user, which violates the
partial unique index `check_ins_one_active_per_user`
(`supabase/migrations/20260912183849_check_ins_one_active_per_user.sql`,
commit `20cc899`) added specifically to close the *concurrent*-request race
identified in the archived `post-meal-checkin-loop` impl-review (finding F1).
That fix appears to have never been re-verified against the plain sequential
"defer" happy path.

Reproduction: `context/changes/testing-collision-invariant-coverage/src/lib/services/meals.test.ts`
(uncommitted in that change) — the "two meals, defer" and "3-meal defer
chain" test cases both fail with this exact error against real local
Supabase.

Likely fix shape (not decided — needs framing/design, not just a patch):
the insert+update need to be atomic from Postgres's point of view. Options
include making the unique constraint `DEFERRABLE INITIALLY DEFERRED` and
wrapping both statements in a single transaction (likely via a Postgres
function/RPC, since two independent Supabase-JS calls aren't otherwise
transactional together), or restructuring the write order/shape entirely.

Blocks: `context/changes/testing-collision-invariant-coverage` Phase 3
cannot pass until this lands.
