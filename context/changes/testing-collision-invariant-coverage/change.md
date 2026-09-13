---
change_id: testing-collision-invariant-coverage
title: Add critical-path tests for meal-collision chain and check-in invariant
status: implementing
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
