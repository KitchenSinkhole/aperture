## connection-death-snapshot.test.ts

**Purpose:** Unit coverage for `boundWormholeCode`, the bound-signature code rule of the connection death snapshot.
**File:** `tests/unit/connection-death-snapshot.test.ts`

Cases: a single non-K162 code wins over a far-end K162 (and over its own duplicate); K162 alone yields `K162`; no codes, or two disagreeing non-K162 codes (with or without a K162), yield null.
