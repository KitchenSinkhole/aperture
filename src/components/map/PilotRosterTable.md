## PilotRosterTable

**Purpose:** Pure sortable pilot table — receives a pre-filtered presence list, manages its own sort state, and renders pilot rows with optional headers, location column, grouping, and owner annotation.
**File:** `src/components/map/PilotRosterTable.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| presence | readonly MapPresenceEntry[] | yes | Pre-filtered pilot list. The table sorts and optionally groups but does not re-filter. |
| systemNameById | Map<number, MapSystemNode> | no | EVE solar-system id → placed map node, for resolving the location cell's map-specific tag. Required only when `showLocationColumn` is true; defaults to an empty map. |
| viewerIds | ReadonlySet<number> | no | Character ids whose account currently has this map open. Used to show the Unplug icon on pilots who are online in-game but not viewing the map. When omitted, viewing status is unknown so the Unplug icon is never shown (rather than flagging everyone). |
| showHeaders | boolean | no | Render sortable `<thead>` column headers. Defaults to `true`. |
| showLocationColumn | boolean | no | Include the Location column (class + tag + system name). Defaults to `true`. |
| showGroupedPlayers | boolean | no | Cluster each account's pilots under their main anchor. Defaults to `false`. |
| showOwner | boolean | no | Annotate alt rows with their main's name in the flat (ungrouped) view. Defaults to `false`. |
| scrollable | boolean | no | Wrap the `InfoTable` in a height-capped, bordered `ScrollTable`. Defaults to `true`; `SystemNode`'s popup passes `false` for a full-height bare table. |

### Renders
An `InfoTable` with an optional sticky `<thead>` (Pilot / Location / Type / Ship — Location omitted when `showLocationColumn` is false) and a `<tbody>`, wrapped in a `ScrollTable` when `scrollable` (the default). Renders "No pilots match your filter." (via `EmptyRow`) when `presence` is empty.

Each pilot row shows the character name plus an amber `Unplug` icon (with a `title`) when the pilot is online in-game but **not** in `viewerIds`. When `viewerIds` is omitted entirely, viewing status is unknown so the icon never shows. In the flat (ungrouped) view, when `showOwner` is on, an alt row (a character that is not its own account main) is annotated with its main's name in muted `(Main Name)` text. Location shows a class-coloured class label, the placed node's tag (same class-coloured `font-mono font-bold` styling, when present), then the system name (falls back to the raw id). Type is the resolved ship hull type. Ship is the pilot's custom hull name, shown only when it differs from the type (ESI defaults `ship_name` to the type name); otherwise `—`.

### Behaviour & Interactions
- **Sort** (local state, default `{ key: 'name', dir: 'asc' }` — preserves the old name-asc order): clicking a header sorts by that column; clicking the active header flips direction. Keys map to `name` (characterName), `location` (`systemName ?? systemId`), `ship-type` (`shipTypeName`), `ship-name` (custom hull name). Blank values (no custom ship name / unknown type) always sink to the bottom regardless of direction; ties break on character name.
- **Grouping** (controlled by `showGroupedPlayers`): clusters each account's online characters using **main-anchored indent**. Within an account, the main is the anchor row (tagged `main`); its alts render indented with a `CornerDownRight` glyph. Members within a group follow the active sort; groups are ordered by main name.
  - **Main not in presence list**: a dimmed italic name label (`main · offline`) anchors the group so its alts don't dangle. This covers both "main is offline" and "main was filtered out by the caller."
  - **No main set** on the account: the first (sorted) member anchors the group unbadged.
- Does **not** own filter/query state — filtering is the caller's responsibility.
- **Reused by `SystemNode`'s `PresenceBadge`**: the per-node hover popup renders this table with `showHeaders={false}` / `showLocationColumn={false}` / `scrollable={false}` and no `viewerIds` (so it's a bare, header-less, non-scrolling Pilot / Type / Ship list for the one system — no Unplug icon, no location, no grouping).

### Depends On
- `InfoTable`/`ScrollTable`/`Th`/`Td`/`EmptyRow` from `@/components/dialogs/infoTable`
- `systemClassColor` from `@/components/map/styling`
- `cn` from `@/lib/utils`
- `Unplug`/`ChevronUp`/`ChevronDown`/`CornerDownRight` from `lucide-react`
- Types `MapPresenceEntry`, `MapSystemNode` from `@/types`

### Local State
- `sort: { key: 'name' | 'location' | 'ship-type' | 'ship-name'; dir: 'asc' | 'desc' }` — active sort column and direction (default name asc).

### Exports
- `customShipName(p: MapPresenceEntry): string` — the pilot's *custom* hull name, or `''` when un-renamed (ESI defaults `ship_name` to the type). Shared so `PilotRoster`'s filter matches the same ship-name rule the table renders.
