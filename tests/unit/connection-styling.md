## connection-styling.test.ts

**Purpose:** Unit coverage that an age-based (`eolSource = 'auto'`) EOL renders apart from an observed one through the shared connection styling helpers.
**File:** `tests/unit/connection-styling.test.ts`

No DB required (pure functions). Cases:
- `connectionStyle` dashes both an observed and an estimated `eol` edge, with the same stroke colour but different dash patterns.
- `connectionBadges` labels the observed EOL badge `EOL` and the estimate `EOL?`.
- `isEolEstimate` is true only for an `auto`-sourced, non-`none` stage.
- `critical` and `expired` styling does not vary with provenance.
