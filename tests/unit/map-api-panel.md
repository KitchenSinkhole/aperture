## map-api-panel.test.tsx

**Purpose:** Component tests for the Map Settings → API tab (`src/components/map/manage/MapApiPanel.tsx`) with its Server Actions mocked.
**File:** `tests/unit/map-api-panel.test.tsx`

Stubs the Base UI-backed `Dialog`, `Button`, `Input` and `Select` primitives so they render inline in jsdom; the dialog stub renders its children only while open and wires `DialogClose` to `onOpenChange(false)`.

### Covers
- Viewer — own tokens listed, no settings form or map-wide list, the create form offering only the scopes the map exposes.
- Manager — the switch and scope checkboxes seeded from the state, and the map-wide list with owner names and computed statuses.
- Blocked account — the banner with the reason and "until an admin lifts it", and a disabled create button.
- One-time reveal — a mint sends the chosen label, scopes and default 90-day expiry, shows the raw token in the reveal dialog with the not-shown-again statement, reloads the state, and drops the token from the DOM once the dialog closes.
- The reveal survives a failed reload after a mint: the error shows and the raw token stays in the reveal dialog.
