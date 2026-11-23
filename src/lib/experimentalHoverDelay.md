## experimentalHoverDelay.ts

**Purpose:** Device-local persistence for experimental UI hover open timing (tooltips, preview cards, hover popovers).
**File:** `src/lib/experimentalHoverDelay.ts`

### Constants
`EXPERIMENTAL_HOVER_DELAY_KEY`, `DEFAULT_EXPERIMENTAL_HOVER_DELAY_MS` (100), min 0 / max 2000.

### clampExperimentalHoverDelayMs(raw): number
Clamps to an integer in the allowed range; non-finite values fall back to the default.

### readExperimentalHoverDelayMs(): number
Reads from `localStorage`; returns the default when unset or on the server.

### writeExperimentalHoverDelayMs(ms): number
Persists the clamped value and dispatches `aperture:experimental-hover-delay` on `window` for live subscribers.
