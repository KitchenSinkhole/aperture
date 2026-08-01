## SystemOverlay

**Purpose:** Floating overlay panel showing the active character's current system, the other pilots in it and their ships, the non-abyssal connections out with mass/EOL state, and Ping/Rally action buttons for the current node.
**File:** `src/components/map/SystemOverlay.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| viewData | MapViewData | yes | The live map snapshot the canvas already maintains (systems + connections). Provides `map.id` used by the Ping and Rally API calls. |

### Renders
A compact, low-chrome vertical panel tuned to be as tight as possible (it lives in a Document PiP window that steals screen space from the game client): a single class+tag+name header line, a self-excluding pilots table, and a connections list of thin rows. The section labels ("Pilots in system" / "Connections") are intentionally **omitted** — the colour mass dot on each connection row and a hairline top border are the only separators. No interactivity, no tooltips (synthetic events don't cross the PiP document).

### Behaviour & Interactions
- Reads `useMapActiveChar()` for `activeCharId` / `activeCharSystemId` and `usePresenceForSystem(activeCharSystemId)` for the in-system roster — so it re-renders live off the presence store's `characterUpdate` folding with no extra wiring.
- **Header:** resolves the `MapSystemNode` where `systemId === activeCharSystemId`; a single baseline row — class (coloured via `systemClassColor(node.security)`) + tag + the muted name/alias inline (no longer a separate line). Class+tag lead because the system name is already visible in-game.
- **Ping button** (right-aligned in header): fires `pingSystemOnServer({ mapId, mapSystemId: node.id })` on click; disabled when no node is on the map or a request is in flight. Border colour `#38bdf8` matches `UNDERGLOW_PRESETS.ping.color`.
- **Rally button** (right-aligned in header, next to Ping): toggles `ap_map_system.rally_at` via `updateSystemOnServer` — sets to the current ISO timestamp when unset, clears to null when already set. Border colour `#9036e4` matches `RALLY_UNDERGLOW.color`. Disabled when no node or request is in flight. **Easter egg:** shift-clicking while *setting* (not clearing) a rally point plays `/sounds/rally.mp3` via the Web Audio API.
- **Off-map fallback:** when the active char's system has no placed node, the header falls back to a roster entry's `systemSecurity` / `systemTrueSec` / `systemName`; no tag, and the connections section is hidden.
- **No located character** (`activeCharSystemId == null`): renders a neutral "No tracked character located" placeholder.
- **Pilots:** roster filtered to `characterId !== activeCharId`; rendered as a compact `table-fixed` table (Pilot | Name | ship-class icon | Type, the icon column narrow and unlabelled under a "Type" header spanning both). Column headers are sortable (asc/desc toggle with chevron indicator); default sort is Type asc. Blank custom-ship-name values always sink to the bottom regardless of direction. Empty state: "Alone in system" text (no table rendered).
- **Connections:** `viewData.connections` incident to the current node and `scope !== 'abyssal'`; each row is `[mass dot] [sig] [class] [tag] [far name] [badges] [EOL countdown]`. The mass dot is coloured by `connectionStyle(edge).stroke` (mass status for WH, scope colour otherwise); the **sig** is the 3-char `sigId` of the in-system signature that resolves to this connection (`viewData.signatures` filtered to `mapSystemId === node.id && mapConnectionId === edge.id` — the sig as seen on *this* scanner, not the far side; `.slice(0, 3)` defensively), muted/mono, between the dot and the class; the far-end node gives the class colour + tag/name; `connectionBadges` minus the EOL badge (STATIC / size); a live EOL countdown when `eolStage !== 'none'`. The section has a hairline top border instead of a label; no heading.

### Depends On
- `useMapActiveChar` (`./MapActiveCharContext`), `usePresenceForSystem` (`./MapPresenceContext`)
- `ShipClassIcon` (`@/components/icons/ShipClassIcon`) — the pilot table's Type column icon
- `systemClassColor`, `connectionStyle`, `connectionBadges` (`./styling`)
- `pingSystemOnServer`, `updateSystemOnServer` (`@/lib/map/client`) — Ping and Rally API calls
- `UNDERGLOW_PRESETS`, `RALLY_UNDERGLOW` (`./underglowPresets`) — button border colours
- `connectionTimeLeftMs` / `connectionExpiredSinceMs` (`@/lib/map/connectionState`), `formatRelativeFromMs` / `formatAgoFromMs` (`@/lib/map/relativeTime`) — the EOL countdown and expired-since label
- `cn` (`@/lib/utils`)
- `ChevronDown`, `ChevronUp` from `lucide-react` — pilot table sort indicators
- Types from `@/types`: `MapViewData`, `MapSystemNode`, `MapConnectionEdge`, `MapPresenceEntry`

### Local State
- `useEolCountdown(edge)` — per-connection-row hook ticking a `now` clock every 30s while the edge is EOL; returns a formatted "time left" string for `eol`/`critical`, an `"expired 3h ago"` elapsed string for the manual `expired` stage, or null.
- `pinging: boolean` (Header) — true while a ping POST is in flight; disables the Ping button.
- `togglingRally: boolean` (Header) — true while a rally PATCH is in flight; disables the Rally button.
- `sort: PilotSort` (Pilots) — `{ key: PilotSortKey; dir: 'asc' | 'desc' }` tracking the active pilot table sort column and direction.
