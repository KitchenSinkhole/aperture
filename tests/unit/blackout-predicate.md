## blackout-predicate.test.ts

**Purpose:** Unit tests for the pure Blackout predicates `isBlackedOut` and `isPilotHidden` (`src/lib/auth/blackout.ts`).
**File:** `tests/unit/blackout-predicate.test.ts`

### Covers
- `isBlackedOut` — true only for an active, non-cleared viewer.
- `isPilotHidden` — hides another account's pilot from a non-cleared viewer while on; never hides the viewer's own account; hides nothing from a cleared viewer or while off.
