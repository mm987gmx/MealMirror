---
change_id: testing-collision-invariant-coverage
title: Add critical-path tests for meal-collision chain and check-in invariant
status: impl_reviewed
created: 2026-09-12
updated: 2026-09-13
archived_at: null
---

## Notes

Open a change folder for rollout Phase 1 of context/foundation/test-plan.md: "Critical-path collision & invariant coverage".
Risks covered: #1 (3+ meal collision corrupts the active-check-in chain / loses meal-symptom traceability), #2 (single-active-check-in invariant violated under near-simultaneous requests).
Test types planned: unit + integration (this phase also bootstraps the test runner — none exists yet).
Risk response intent:
- #1: prove that a 3rd meal logged during an unresolved deferred check-in yields exactly one active check-in and a traceable supersede chain; must not assume the 2-meal case generalizes.
- #2: prove no request race can create two simultaneously active check-ins for one user, and that a constraint violation surfaces as a clear error rather than a silent wrong state.
After creating the folder, follow the downstream continuation rule.

## Blocked (2026-09-13) — Resolved (2026-09-13)

Fixed by `context/changes/fix-defer-checkin-race` (commits `3479eb9`, `c719bf1`, `2687e38`).
Phase 3 resumed and `src/lib/services/meals.test.ts` now passes in full.

Phase 3 (collision/defer chain tests) is paused. `src/lib/services/meals.test.ts` (uncommitted,
written but not landed) revealed that `deferCheckIn` (src/lib/services/check-ins.ts:40-54) is
currently broken for ANY sequential "defer" call, not just the 3-meal case: it inserts the new
active check-in before marking the old one superseded, which now violates the
`check_ins_one_active_per_user` partial unique index (migration 20260912183849, commit 20cc899)
added to close the *concurrent*-request race. This is a real product bug, not a test-design
question — fixing it is out of scope for this change per this project's lesson boundaries
(bug-fix-then-regression-test is a separate lesson). A separate change should fix this before
Phase 3 resumes. See src/lib/services/meals.test.ts's two failing "defer" tests for the exact
reproduction.
