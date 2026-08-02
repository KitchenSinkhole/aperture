## PilotRosterTable

**Purpose:** Pure sortable pilot table — receives a pre-filtered presence list, manages its own sort state, and renders pilot rows with grouping and owner annotation.
**File:** `src/components/map/PilotRosterTable.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| presence | readonly MapPresenceEntry[] | yes | Pre-filtered pilot list. The table sorts and optionally groups but does not re-filter. |
| systemNameById | Map<number, MapSystemNode> | no | EVE solar-system id → placed map node, for resolving the location cell's map-specific tag. Defaults to an empty map. |
| viewerIds | ReadonlySet<number> | no | Character ids whose account currently has this map open. Used to show the Unplug icon on pilots who are online in-game but not viewing the map. When omitted, viewing status is unknown so the Unplug icon is never shown (rather than flagging everyone). |
| showGroupedPlayers | boolean | no | Cluster each account's pilots under their main anchor. Defaults to `false`. |
| showOwner | boolean | no | Annotate alt rows with their main's name in the flat (ungrouped) view. Defaults to `false`. |

### Renders
An `InfoTable` with a sticky `<thead>` (Pilot / Location / [icon] / Type / Ship) and a `<tbody>`, wrapped in a `ScrollTable`. Renders "No pilots match your filter." (via `EmptyRow`) when `presence` is empty.

The dense, header-less per-system popup is a separate component — see `SystemPresenceTable`.

Each pilot row shows the character name plus an amber `Unplug` icon (with a `title`) when the pilot is online in-game but **not** in `viewerIds`. When `viewerIds` is omitted entirely, viewing status is unknown so the icon never shows. In the flat (ungrouped) view, when `showOwner` is on, an alt row (a character that is not its own account main) is annotated with its main's name in muted `(Main Name)` text. Location shows a class-coloured class label, the placed node's tag (same class-coloured `font-mono font-bold` styling, when present), then the system name (falls back to the raw id). A narrow unlabelled column between Location and Type carries a `ShipClassIcon` (`p.shipClass`). Type is the resolved ship hull type name. Ship is the pilot's custom hull name, shown only when it differs from the type (ESI defaults `ship_name` to the type name); otherwise `—`. The Type and Ship cells clip to a responsive max width with an ellipsis and expose the full value via a native `title` tooltip.

### Behaviour & Interactions
- **Sort** (local state, default `{ key: 'name', dir: 'asc' }` — preserves the old name-asc order): clicking a header sorts by that column; clicking the active header flips direction. Keys map to `name` (characterName), `location` (`systemName ?? systemId`), `ship-type` (`shipTypeName`), `ship-name` (custom hull name). Blank values (no custom ship name / unknown type) always sink to the bottom regardless of direction; ties break on character name.
- **Grouping** (controlled by `showGroupedPlayers`): clusters each account's online characters using **main-anchored indent**. Within an account, the main is the anchor row (tagged `main`); its alts render indented with a `CornerDownRight` glyph. Members within a group follow the active sort; groups are ordered by main name.
  - **Main not in presence list**: a dimmed italic name label (`main · offline`) anchors the group so its alts don't dangle. This covers both "main is offline" and "main was filtered out by the caller."
  - **No main set** on the account: the first (sorted) member anchors the group unbadged.
- Does **not** own filter/query state — filtering is the caller's responsibility.

### Depends On
- `InfoTable`/`ScrollTable`/`Th`/`Td`/`EmptyRow` from `@/components/dialogs/infoTable`
- `ShipClassIcon` from `@/components/icons/ShipClassIcon`
- `systemClassColor` from `@/components/map/styling`
- `cn` from `@/lib/utils`
- `Unplug`/`ChevronUp`/`ChevronDown`/`CornerDownRight` from `lucide-react`
- Types `MapPresenceEntry`, `MapSystemNode` from `@/types`

### Local State
- `sort: { key: 'name' | 'location' | 'ship-type' | 'ship-name'; dir: 'asc' | 'desc' }` — active sort column and direction (default name asc).

### Depends On
- `customShipName` from `@/lib/map/shipName` — the pilot's custom hull name; `PilotRoster`'s filter uses the same helper so it matches the ship-name rule the table renders.
