## SystemOverlay

**Purpose:** Floating overlay panel showing the active character's current system, a search/D-Scan box over the other pilots in it and their ships, the non-abyssal connections out with mass/EOL state, and Ping/Rally action buttons for the current node.
**File:** `src/components/map/SystemOverlay.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| viewData | MapViewData | yes | The live map snapshot the canvas already maintains (systems + connections). Provides `map.id` used by the Ping and Rally API calls. |

### Renders
A compact, low-chrome vertical panel tuned to be as tight as possible (it lives in a Document PiP window that steals screen space from the game client): a single class+tag+name header line, a search box with a zero-height-when-idle result area under it, a self-excluding pilots table, and a connections list of thin rows. The section labels ("Pilots in system" / "Connections") are intentionally **omitted** — the colour mass dot on each connection row and a hairline top border are the only separators. No interactivity, no tooltips (synthetic events don't cross the PiP document).

### Behaviour & Interactions
- Reads `useMapActiveChar()` for `activeCharId` / `activeCharSystemId` and `usePresenceForSystem(activeCharSystemId)` for the in-system roster — so it re-renders live off the presence store's `characterUpdate` folding with no extra wiring.
- **Header:** resolves the `MapSystemNode` where `systemId === activeCharSystemId`; a single baseline row — class (coloured via `systemClassColor(node.security)`) + tag + the muted name/alias inline (no longer a separate line). Class+tag lead because the system name is already visible in-game.
- **Ping button** (right-aligned in header): fires `pingSystemOnServer({ mapId, mapSystemId: node.id })` on click; disabled when no node is on the map or a request is in flight. Border colour `#38bdf8` matches `UNDERGLOW_PRESETS.ping.color`.
- **Rally button** (right-aligned in header, next to Ping): toggles `ap_map_system.rally_at` via `updateSystemOnServer` — sets to the current ISO timestamp when unset, clears to null when already set. Border colour `#9036e4` matches `RALLY_UNDERGLOW.color`. Disabled when no node or request is in flight. **Easter egg:** shift-clicking while *setting* (not clearing) a rally point plays `/sounds/rally.mp3` via the Web Audio API.
- **Off-map fallback:** when the active char's system has no placed node, the header falls back to a roster entry's `systemSecurity` / `systemTrueSec` / `systemName`; no tag, and the connections section is hidden.
- **No located character** (`activeCharSystemId == null`): renders a neutral "No tracked character located" placeholder.
- **Pilots:** roster filtered to `characterId !== activeCharId`; rendered as a compact `table-fixed` table (Pilot | Name | ship-class icon | Type, the icon column narrow and unlabelled under a "Type" header spanning both). Column headers are sortable (asc/desc toggle with chevron indicator); default sort is Type asc. Blank custom-ship-name values always sink to the bottom regardless of direction. Empty state: "Alone in system" text (no table rendered).
- **Search / D-Scan** (between the header and the pilot table, placeholder `Search or paste D-SCAN`, rendered only while the roster has someone in it — nothing to search when alone in system, and unmounting drops any result set still on screen): searches the same self-excluding roster the pilot table shows, rendering hits into a result area directly beneath the box — a square-cornered panel on a lighter surface than the overlay, spaced off the pilot table below it so the two don't read as one list. The area occupies no height while there is no result set.
  - **Paste:** clipboard text that `parseDscanPaste` accepts as at least one D-Scan row is intercepted (`preventDefault`, box left empty) and never falls through to a text search — including a scan of nothing but structures, which renders `No ships in D-SCAN` rather than being searched as text. Rows are then narrowed to ships, dropping everything else a scan lists: a row survives when the SDE ship-type catalog holds its type id **or** a roster pilot is flying it. The catalog is the SDE's `Ship` category, so capsules count as ships. The catalog is awaited at paste time and memoised for the session, so only the first paste after a reload costs a request; when it is null (the fetch failed, already toasted) the roster clause alone still recognises the panel's own fleet. Each surviving line resolves to the roster entry on the same `shipTypeId` plus, in order, an exact ship-name match, else the client's `<Pilot>'s <Type>` default anchored at the start of the name cell — anchored so a pilot whose name prefixes another's can't claim their ship, and an ambiguous prefix resolves to nobody rather than to whoever the roster lists first — matched lines render the pilot's own row from the list, unmatched ones render a synthesized row entirely in shades of red — `Unknown pilot` in the Pilot column, then the D-Scan ship name and type — plus the hull icon `resolveShipClass` gives for the type id and the group the catalog holds for it (icon cell left empty when that resolves to null). Unmatched rows are listed first, scan order preserved within each group.
  - **Typed query:** debounced case-insensitive substring match over pilot name / ship name / hull type. Every occurrence of the query is `<mark>`ed in the result rows' pilot, ship-name and type cells, so the cell that produced the hit is visible at a glance; a D-Scan paste marks nothing, having matched on type id rather than on any text the row shows. No hit renders `"<query>" not found`, the echoed query cut to `QUERY_ECHO_MAX` characters with an ellipsis so a long one can't wrap the line. Clearing the box drops the result set immediately.
  - A result set is a **frozen snapshot** — presence updates neither refresh it nor restart its countdown. It self-clears after `RESULT_TTL_MS` (30s), counted down by `ResultProgress`: a muted-foreground line filling left to right on a faded track of the same colour, above the rows. Its styling and keyframe live in `globals.css` (`ap-result-track` / `ap-result-fill`); only the animation duration rides in as an inline style, taken from `RESULT_TTL_MS` so the fill cannot drift from the timer that drops the rows. Because `useDocumentPip` clones the opener's stylesheets once when the window opens, a change to those rules reaches an already-open overlay only after it is closed and reopened.
- **Connections:** `viewData.connections` incident to the current node and `scope !== 'abyssal'`; each row is `[mass dot] [sig] [class] [tag] [far name] [badges] [EOL countdown]`. The mass dot is coloured by `connectionStyle(edge).stroke` (mass status for WH, scope colour otherwise); the **sig** is the 3-char `sigId` of the in-system signature that resolves to this connection (`viewData.signatures` filtered to `mapSystemId === node.id && mapConnectionId === edge.id` — the sig as seen on *this* scanner, not the far side; `.slice(0, 3)` defensively), muted/mono, between the dot and the class; the far-end node gives the class colour + tag/name; `connectionBadges` minus the EOL badge (STATIC / size); a live EOL countdown when `eolStage !== 'none'`. The section has a hairline top border instead of a label; no heading.

### Depends On
- `useMapActiveChar` (`./MapActiveCharContext`), `usePresenceForSystem` (`./MapPresenceContext`)
- `ShipClassIcon` (`@/components/icons/ShipClassIcon`) — the pilot table's Type column icon
- `Input` (`@/components/ui/input`) — the search box
- `parseDscanPaste` (`@/lib/map/dscanParser`) — clipboard D-Scan splitter; an empty result means the paste was not D-Scan
- `fetchShipTypeGroups` (`@/lib/reference/client`) — the SDE ship type id → group catalog, awaited on paste; decides which scanned rows are hulls
- `resolveShipClass` (`@/lib/eve/shipClass`) — hull icon for an unmatched row, from the type id and the group the catalog gives for it
- `systemClassColor`, `connectionStyle`, `connectionBadges` (`./styling`)
- `pingSystemOnServer`, `updateSystemOnServer` (`@/lib/map/client`) — Ping and Rally API calls
- `UNDERGLOW_PRESETS`, `RALLY_UNDERGLOW` (`./underglowPresets`) — button border colours
- `connectionTimeLeftMs` / `connectionExpiredSinceMs` (`@/lib/map/connectionState`), `formatRelativeFromMs` / `formatAgoFromMs` (`@/lib/map/relativeTime`) — the EOL countdown and expired-since label
- `cn` (`@/lib/utils`)
- `ChevronDown`, `ChevronUp` from `lucide-react` — pilot table sort indicators
- Types from `@/types`: `MapViewData`, `MapSystemNode`, `MapConnectionEdge`, `MapPresenceEntry`, `ParsedDscanRow`, `ShipClass`

### Local State
- `useEolCountdown(edge)` — per-connection-row hook ticking a `now` clock every 30s while the edge is EOL; returns a formatted "time left" string for `eol`/`critical`, an `"expired 3h ago"` elapsed string for the manual `expired` stage, or null.
- `pinging: boolean` (Header) — true while a ping POST is in flight; disables the Ping button.
- `togglingRally: boolean` (Header) — true while a rally PATCH is in flight; disables the Rally button.
- `sort: PilotSort` (Pilots) — `{ key: PilotSortKey; dir: 'asc' | 'desc' }` tracking the active pilot table sort column and direction.
- `query: string` (PilotSearch) — the search box's text; a D-Scan paste leaves it empty.
- `outcome: SearchOutcome | null` (PilotSearch) — `{ id, emptyMessage, highlight, results }`, the current frozen result set. `null` collapses the result area to nothing. The `id` keys the rendered area so a new set restarts the countdown; `emptyMessage` is shown in place of rows when nothing matched; `highlight` is the query marked inside the rows, null for a D-Scan paste.
