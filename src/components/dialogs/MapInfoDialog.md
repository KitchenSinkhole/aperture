## MapInfoDialog

**Purpose:** Three-tab live snapshot of the open map — Summary, Systems, Connections. (The online-pilot roster lives in the toolbar's `PilotRosterButton` popover, not here.)
**File:** `src/components/dialogs/MapInfoDialog.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| open | boolean | yes | Controlled open state (owned by `MapCanvas`). |
| onOpenChange | (open: boolean) => void | yes | Open-state setter. |
| viewData | MapViewData | yes | The canvas's live map data (map meta, systems, connections). Realtime-current. |

### Renders
A `max-w-3xl` dialog with a `Tabs` strip. **Summary**: count tiles (systems / connections / online pilots) + a copy-to-clipboard share link (`${origin}/map/<id>`). **Systems**: scrollable table of every system (name/alias, region/constellation, security, status, statics), sorted by name. **Connections**: scrollable table (source → target resolved to system names, scope, mass status, jump size, EOL stage — `EOL` for the 4h stage (`EOL (estimated)` when `isEolEstimate`), `EOL 1h` for critical, `Expired` for the manual expired stage).

### Behaviour & Interactions
- Reads everything from `viewData` (props) + `usePresenceForMap()` (context) — **no server call**. Reopening reflects whatever the canvas state currently is.
- The online-pilot count tile comes from the map-wide presence store, so it tracks realtime `characterUpdate` movement while the dialog is mounted. (The full roster moved to `PilotRosterButton`.)
- Share-link copy uses `navigator.clipboard` and toasts success/failure via `sonner`.

### Depends On
- `@/components/ui/dialog`, `@/components/ui/tabs`, `@/components/ui/button`
- `ScrollTable`/`Th`/`Td`/`EmptyRow` from `@/components/dialogs/infoTable`
- `usePresenceForMap` from `@/components/map/MapPresenceContext` (must render inside `MapPresenceProvider`)
- `isEolEstimate` from `@/components/map/styling`
- Types `MapViewData`, `MapSystemNode`, `MapConnectionEdge` from `@/types`
