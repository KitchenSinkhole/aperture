## ExperimentalThemeToggle

**Purpose:** Map-toolbar menu to switch experimental UI theme (`aperture` / `slate` / `light` / `classic`) without opening Account settings.
**File:** `src/components/map/ExperimentalThemeToggle.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| mode | ExperimentalUiMode | yes | Active theme from `MapCanvas` (SSR-seeded). |
| onModeChange | (mode) => void | yes | Persists via `writeExperimentalUi` / `setExperimentalUi`. |

Renders only when the caller gates experimental UI. Map toolbar menu — no separate client-only mount gate.
