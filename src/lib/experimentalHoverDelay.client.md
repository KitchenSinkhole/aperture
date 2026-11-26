## experimentalHoverDelay.client.tsx

**Purpose:** React context and `Tooltip.Provider` wiring so experimental UI hovers share one open delay.
**File:** `src/lib/experimentalHoverDelay.client.tsx`

### ExperimentalHoverDelayProvider
When experimental UI is active, wraps children in Base UI `Tooltip.Provider` with `delay` / `closeDelay` from `readExperimentalHoverDelayMs`. Subscribes to cookie/`data-ui` changes and `aperture:experimental-hover-delay` storage events. Legacy mode passes children through without altering tooltip timing.

### useExperimentalHoverDelayContext()
`{ delayMs, setDelayMs, experimentalActive }`.

### useExperimentalHoverTriggerDelays()
Returns `{ delay, closeDelay }` for `PreviewCard.Trigger` (and similar) when experimental is on; `undefined` in legacy UI.
