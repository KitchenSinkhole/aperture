## read-sequence.test.ts

**Purpose:** Unit tests for `ReadSequence` (`src/lib/realtime/readSequence.ts`), the read ordering behind the WS server's Blackout switch and per-socket standing.
**File:** `tests/unit/read-sequence.test.ts`

### Covers
- Starts settled; an initial `invalidate` holds until the first success.
- Newest success wins: an older success is applied when the newer read fails, and discarded when it finishes after a newer success.
- After `invalidate`, a failed read keeps it unsettled until a later read succeeds; a read already in flight at the `invalidate` does not settle it; overlapping `invalidate`s need a read begun after the last one.
- A failed read unsettles until a later success, unless a newer success is already applied.
