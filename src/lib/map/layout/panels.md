## panels.ts

**Purpose:** Single source of truth for the map dashboard's panels and their default arrangement (map-layout-builder).
**File:** `src/lib/map/layout/panels.ts`

---

### LAYOUT_CONFIG_VERSION
`number` (currently `2`). Bumped when `MapLayoutConfig`'s stored shape changes incompatibly; gates the `migrateLayout` upgrade of saved layouts.

### PANEL_BREAKPOINTS
`Record<Breakpoint, number>` — `{ lg: 1200, md: 768, sm: 0 }`. Min container widths (px) for the responsive grid; shared by the grid component (later stages).

### PANEL_COLS
`Record<Breakpoint, number>` — `{ lg: 12, md: 8, sm: 4 }`. Column count per breakpoint.

### PANELS
`PanelDef[]` — the registry of every panel in DOM source order (which drives single-column `sm` stacking). Each `PanelDef` is `{ id: PanelId; title: string; defaultVisible: boolean; minW: number; minH: number }`. Order: canvas, signatures, sigSearch (displayed as "Signature Search"), inspector, route, intel, structure, killStats, systemGraph, systemKillboard, tags, thera (displayed as "Eve-Scout"). `minW`/`minH` are the per-panel resize floors **in grid columns/rows** (not px) — edit them here to change how small a panel can be dragged.

### PANEL_MIN
`Record<PanelId, { minW: number; minH: number }>` — the resize floors derived from `PANELS`. Authoritative: `MapLayoutGrid` re-applies these over each stored layout item at render time, so lowering a floor takes effect for already-saved per-account layouts without disturbing their persisted positions.

### DEFAULT_MAP_LAYOUT
`MapLayoutConfig` — the fallback used when `ap_user.map_layout` is NULL. The built-in fixed layout: a tall `canvas` top-left, full-width `signatures` beneath it, and the info modules stacked in a right column. Built per breakpoint — `lg`/`md` via `wideLayout(cols)` (left canvas+signatures, right module stack), `sm` via a single-column stack in registry order. `groups` holds one singleton group per layout item (`id === its PanelId`); `hidden: []`.

### ensurePanelsPlaced(config: MapLayoutConfig): MapLayoutConfig
Forward-compat normaliser run when seeding layout state on load. Ensures every panel in `PANELS` has a layout item in every breakpoint; a panel that shipped after the user last saved (so it's absent from their stored `layouts[bp]`) is appended below the existing items at `x: 0`, stacked by its `minH`, sized `Math.min(cols, max(minW, 4)) × max(minH, 4)`, and added as a matching singleton group in `groups[bp]`. No data migration needed for future panels.

**Parameters:**
- `config` — the layout to normalise (a migrated saved config, or `DEFAULT_MAP_LAYOUT`).

**Returns:** A config with all panels placed. Returns the input **unchanged by reference** when nothing was missing (the common case — `DEFAULT_MAP_LAYOUT` is already complete).

### migrateLayout(config: StoredMapLayout): MapLayoutConfig
Version normaliser run before `ensurePanelsPlaced` when seeding layout state and before persisting in `setMapLayoutAction`. A pre-v2 blob has no `groups`; for each breakpoint it derives one singleton group per `layouts[bp]` item (`{ id: item.i, members: [item.i], active: item.i }`) and sets `version` to `LAYOUT_CONFIG_VERSION`, preserving the arrangement so every panel becomes its own untabbed cell.

**Parameters:**
- `config` — a layout blob as read from storage or an imported file; `groups` may be absent.

**Returns:** A complete `MapLayoutConfig`. Returns an already-grouped config's grouping intact.

### PanelDef (type)
`{ id: PanelId; title: string; defaultVisible: boolean; minW: number; minH: number }`.
