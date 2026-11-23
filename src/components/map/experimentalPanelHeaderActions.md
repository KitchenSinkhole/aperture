## experimentalPanelHeaderActions.tsx

**Purpose:** Experimental per-panel **+ Add** header button wired through `experimentalPanelActionBus`.
**File:** `src/components/map/experimentalPanelHeaderActions.tsx`

### Exports

- `ExperimentalPanelAddButton` — renders for `route`, `pilots`, `kills`, `dscan`, `thera`, `inspector`.
- `experimentalPanelSupportsAdd(panelId)` — palette gating helper.

### Depends On

- `@/lib/experimentalPanelActionBus` — `requestExperimentalPanelAdd`
- `docs/aperture-panel-actions.md` — action semantics
