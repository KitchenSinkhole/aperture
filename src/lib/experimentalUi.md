## experimentalUi.ts

**Purpose:** Opt-in experimental UI family — parse and persist the unsigned `ap_ui` cookie, SSR `<html>` attributes, and client-side live toggling without reload.
**File:** `src/lib/experimentalUi.ts`

### `ExperimentalUiMode`
`'off' | 'aperture' | 'slate' | 'light' | 'classic'`. `aperture` (cookie `exp-dark`) is the default experimental theme (current Aperture colours); `slate` (`exp-slate`) is the blue experimental palette.

### Cookie values
`exp-dark`, `exp-slate`, `exp-light`, `exp-classic`; absent or unknown ⇒ `off`.

### `experimentalUiHtmlAttributes(mode)`
Sets `data-ui`, `data-theme`, and `data-variant` on `<html>` when active.

### `experimentalMapStyleVariant(mode)`
Maps the UI mode to `MapStyleVariant` for the map canvas.

### Client hook
`useExperimentalUi(serverInitial?)` in `experimentalUi.client.ts` seeds from the SSR cookie when provided, then mirrors cookie/`data-*` attributes in place.
