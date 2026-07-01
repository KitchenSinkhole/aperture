## PilotRoster

**Purpose:** Sortable, filterable table of online tracked pilots — filter input and Group/Mains toolbar above a `PilotRosterTable`. Owns query, grouping, and owner-annotation state; filters the presence list before passing it to the table.
**File:** `src/components/map/PilotRoster.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| presence | readonly MapPresenceEntry[] | yes | The online + located pilot roster (from `usePresenceForMap()`). Each entry carries `userId`/`mainCharacterId`/`mainCharacterName` for grouping. |
| systemNameById | Map<number, MapSystemNode> | yes | EVE solar-system id → placed map node, for resolving the map-specific tag. |
| viewerIds | ReadonlySet<number> | yes | Character ids whose account currently has this map open in a live socket (from `GET /api/map/[id]/viewers`, polled by `PilotRosterButton`; account-level coverage, so an account's alts all count as "viewing" when it has the map open). |

### Renders
A toolbar (free-text filter `Input` with a `Search` icon + a `Group` toggle `Button` + a `Mains` toggle `Button`) above a `PilotRosterTable` (with the Location column shown). Empty states: a standalone message when no tracked pilots are online at all (skips the toolbar entirely); "No pilots match your filter" comes from `PilotRosterTable` when the filter excludes everyone.

### Behaviour & Interactions
- **Filter** (local `query`): case-insensitive substring match across character name, **main name**, system name, ship type, and custom ship name. Applied before passing presence to `PilotRosterTable`.
- **Mains toggle** (local `showOwner`, default on): toggles the muted `(Main Name)` owner annotation on alt rows in the flat view (passed through to `PilotRosterTable`). Disabled while grouping is on, where the anchor already conveys ownership.
- **Group toggle** (local `grouped`, default off): clusters each account's online characters using **main-anchored indent** (see `PilotRosterTable`). A group is shown if **any** of its members match the filter, and the main row stays visible as context even when only an alt matched.
- The `grouped` + `showOwner` toggles persist to `localStorage` under `aperture:pilot-roster:prefs` (lazy `useState` init reads it; a `useEffect` writes on change), so the roster keeps its layout across popover open/close and reloads. Sort and filter are intentionally not persisted (transient per-session).

### Emits / Calls
- Renders `PilotRosterTable` with `showHeaders`, `showGroupedPlayers`, `showOwner`, `viewerIds`, `systemNameById`, and the filtered presence list (location column shown by default).

### Depends On
- `PilotRosterTable` + `customShipName` (shared hull-name helper, used by the filter) from `./PilotRosterTable`
- `EmptyRow` from `@/components/dialogs/infoTable`
- `Input` from `@/components/ui/input`, `Button` from `@/components/ui/button`
- `Crown`/`Search`/`UsersRound` from `lucide-react`
- Types `MapPresenceEntry`, `MapSystemNode` from `@/types`

### Local State
- `query: string` — filter text
- `grouped: boolean` — group-alts-under-main toggle (persisted)
- `showOwner: boolean` — `Mains` toggle: muted owner annotation on flat-view alt rows (persisted)
