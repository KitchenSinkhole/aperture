# Tabbed Panels (issue #158)

**Goal:** Let map dashboard panels be combined into tabbed groups — multiple panels share one grid cell, selectable from a tab strip in the header — the way EVE lets you combine windows.

## Context

Users have many panels; some are always-watched, some checked rarely. The current free-form grid (react-grid-layout) forces every panel to occupy its own cell, so rarely-used panels either eat space or get scrolled off. Issue #158 (from Discord) asks for EVE-style window combining: drag one panel's header onto another to nest it as a tab, click tabs to switch, reorder tabs by dragging, and tear a tab back out into the grid. This makes far better use of the limited dashboard space.

The map layout today assumes **one grid cell = one panel**, keyed by `PanelId`. This plan replaces that with **one grid cell = one panel group** (an ordered list of member panels plus an active tab). A single-member group is the degenerate "untabbed panel" case, so the whole existing UI is just the 1-member instance of the new model.

**References:**
- `src/lib/map/layout/panels.ts` / `.md` — registry, `DEFAULT_MAP_LAYOUT`, `ensurePanelsPlaced`, breakpoint/col/min constants.
- `src/lib/map/layout/schema.ts` / `.md` — `mapLayoutConfigSchema` Zod boundary.
- `src/components/map/layout/MapLayoutGrid.tsx` / `.md` — RGL `Responsive` wrapper, drag handle `.ap-panel-drag`.
- `src/components/map/layout/MapPanel.tsx` / `.md` — panel chrome (grip + title + headerRight + hide).
- `src/components/map/MapCanvas.tsx` / `.md` — `mergeLayouts` (L207), layout state, `handleLayoutChange`/`handleHide`/`handleToggleVisible`/`handleResetLayout`/`handleImportFile` (L460–575), render at L1918–1934, `panelContent(id)` / `panelHeaderRight(id)`.
- `src/types/index.ts` — `PanelId`, `Breakpoint`, `MapLayoutConfig` (L501–529).
- Storage: `ap_user.map_layout` jsonb (migration 0033). **No DB migration needed** — shape lives entirely in the jsonb blob, gated by `LAYOUT_CONFIG_VERSION`.
- CLAUDE.md rules: companion `.md` kept accurate in the same edit; shared domain types in `src/types/index.ts`; validate only at the boundary (Zod on the imported/persisted blob).

**Key decisions (confirmed with user):**
- DnD layer: **@dnd-kit** (`@dnd-kit/core` + `@dnd-kit/sortable`), layered over RGL, coexisting with RGL's header-grip drag.
- Ship as **one deliverable** — merge, tab-switch, reorder, and tear-off all working before it lands. Stages below are internal checkpoints, not partial releases.
- Old flat layouts **migrate, not reset**: `LAYOUT_CONFIG_VERSION` bumps to 2 and a normaliser wraps each legacy flat item as a singleton group. No user loses their arrangement.

## Data model

New group-aware shape (in `src/types/index.ts`):

```ts
interface PanelGroup {
  id: string;              // grid item `i`; stable, e.g. `grp_<nanoid>` (singletons may reuse the PanelId)
  members: PanelId[];      // ordered; tab order
  active: PanelId;         // must be in members
}
interface MapLayoutConfig {
  version: number;
  layouts: Record<Breakpoint, Layout>;   // RGL items now keyed by group id
  groups: Record<Breakpoint, PanelGroup[]>; // per-breakpoint grouping (a panel may be tabbed on lg but standalone on sm)
  hidden: PanelId[];
}
```

Grouping is **per-breakpoint** (parallels `layouts` being per-breakpoint): a group's geometry is an RGL item in `layouts[bp]` whose `i` is the group id; `groups[bp]` maps that id to its members/active tab. `hidden` stays a flat `PanelId[]` (hiding is panel-level, breakpoint-independent).

## Stages

### Stage 1 — Group-aware model, schema, migration
**Mode:** Plan mode
**Goal:** New types + Zod + version-2 normaliser, with the whole app still rendering singleton groups identically to today. No tabs visible yet.
**Touches:** `src/types/index.ts`, `src/lib/map/layout/panels.ts`, `src/lib/map/layout/schema.ts`, `src/components/map/MapCanvas.tsx` (`mergeLayouts` + layout state seed), and the four companion `.md`s.
- Add `PanelGroup` + extend `MapLayoutConfig` in `types/index.ts`.
- `panels.ts`: rebuild `DEFAULT_MAP_LAYOUT` to include `groups` (every panel a singleton group whose id === its `PanelId`, so default geometry is unchanged). Rewrite `ensurePanelsPlaced` to also back-fill missing panels as new singleton groups. Bump `LAYOUT_CONFIG_VERSION` to 2. Add a `migrateLayout(config)` that, when it sees a v1 (no `groups`) blob, derives singleton groups from `layouts[bp]` item ids.
- `schema.ts`: extend `mapLayoutConfigSchema` with a `groups` record of `{ id, members: PanelId[] (nonempty, unique), active: PanelId }`, and cross-check `active ∈ members` via `.refine`. Keep bounded array caps.
- `MapCanvas.tsx`: `mergeLayouts` already unions by item `i` — now `i` is a group id, so it keeps working; thread `groups` through the immutable `setLayout` updates. Seed state with `migrateLayout(ensurePanelsPlaced(...))`.
**Done when:** `pnpm lint && pnpm typecheck && pnpm build` green; opening a map with a saved v1 layout renders exactly as before (every panel its own cell); export/import round-trips the new shape.

### Stage 2 — Tabbed panel chrome (render only)
**Mode:** Accept edits
**Goal:** A multi-member group renders a tab strip in the header and shows only the active tab's body. No DnD yet; groups only arise from a temporary dev seed / manual state to prove rendering.
**Touches:** new `src/components/map/layout/MapPanelGroup.tsx` (+ `.md`), `src/components/map/layout/MapPanel.tsx` (+ `.md`), `MapCanvas.tsx` render block (L1918–1934), companion updates.
- `MapCanvas` render: iterate `visibleGroups` (groups whose members aren't all hidden) instead of `visiblePanels`; render one `MapPanelGroup` per grid cell keyed by group id.
- `MapPanelGroup`: header shows a tab per member (title from `PANELS`), highlights `active`, click switches active (local `setLayout` + `saveLayout`), per-tab close (hide), whole-group hide when it's a singleton. Body renders `panelContent(active)`; keep non-active members mounted-but-hidden only if cheap — default to rendering active only (modules self-fetch on select, so unmount is fine). `panelHeaderRight(active)` renders in the active tab's context.
- `MapPanel` becomes the singleton/simple-chrome primitive that `MapPanelGroup` composes, or is folded into `MapPanelGroup`; keep `PANEL_DRAG_HANDLE_CLASS`/`PANEL_NO_DRAG_CLASS` exports for the grid drag handle. The RGL drag handle must sit on the group header background (not the tabs), so dragging the header still moves the whole cell.
**Done when:** CI green; a seeded 2-member group shows two tabs, clicking switches bodies, whole-cell drag/resize still works, the RGL grip still moves the group.

### Stage 3 — dnd-kit: merge + reorder
**Mode:** Plan mode
**Goal:** Real interactions for creating and ordering tabs. Header-onto-header merge and intra-header tab reorder, built on dnd-kit, coexisting with RGL's grip drag.
**Touches:** `package.json` (add `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`), `MapPanelGroup.tsx`, new `src/components/map/layout/PanelDndContext.tsx` (+ `.md`) wrapping the grid, `MapCanvas.tsx` (group mutation handlers), companions.
- Wrap `MapLayoutGrid` in a dnd-kit `DndContext`. Each tab is a `useSortable` draggable; each group header is a droppable.
- **Reorder:** dragging a tab within its own header reorders `members` (dnd-kit `SortableContext` + `arrayMove`).
- **Merge:** dragging a tab (or a singleton's whole header handle) onto another group's header appends it to that group's `members`, sets it active there, and removes it (and its now-empty group) from `layouts[bp]`/`groups[bp]`. Show a drop-target highlight on the hovered header.
- Disambiguation: dnd-kit owns tab drags (activated from the tab elements / a dedicated group-move handle); RGL's `.ap-panel-drag` grip continues to own whole-cell moves. Ensure the two activators don't both fire (dnd-kit `PointerSensor` activation constraint + `cancel`/`handle` scoping on RGL).
- New handlers in `MapCanvas`: `mergePanelIntoGroup`, `reorderTab`, `setActiveTab`, all immutable `setLayout` + `saveLayout`, per-breakpoint.
**Done when:** CI green; can drag a panel header onto another to tab it, reorder tabs, switch tabs; layout persists and reloads; whole-group move/resize unaffected.

### Stage 4 — dnd-kit: tab tear-off to grid (with ghost)
**Mode:** Plan mode
**Goal:** Drag a tab out of a header into the main grid area; show a ghosted placement outline; on drop, split it into its own new group at that location. Completes the feature.
**Touches:** `PanelDndContext.tsx`, `MapPanelGroup.tsx`, `MapLayoutGrid.tsx` (expose a drop zone + a way to compute grid x/y from pointer), `MapCanvas.tsx` (`tearOffTab`), companions.
- Make the grid surface a dnd-kit droppable. On drag-over with a tab payload outside any header, translate the pointer to grid coords (use RGL cols/rowHeight/margin + measured container width from `useContainerWidth`) and render a ghost outline at the snapped cell (reuse RGL's placeholder styling if reachable, else a simple absolutely-positioned outline).
- On drop: remove the tab from its source group (drop the source group if it empties), create a new singleton group at the ghost's x/y with the panel's `PANEL_MIN` size, insert into `layouts[bp]` + `groups[bp]`. Let RGL's compaction settle collisions.
- Edge cases: tearing off the active tab picks a new active in the source; tearing off the last member is a no-op (it's already standalone — treat as a move).
**Done when:** CI green; a tab can be torn off with a visible ghost and lands as its own cell; source group collapses correctly; persists/reloads; run the app (`pnpm dev`) and exercise merge → reorder → switch → tear-off end to end.

### Stage 5 — Wiring, edge cases, docs sweep
**Mode:** Accept edits
**Goal:** Reconcile the group model with every existing layout pathway and finish companions.
**Touches:** `MapCanvas.tsx` (`handleHide`, `handleToggleVisible`, `handleResetLayout`, `handleExportLayout`, `handleImportFile`, panels menu at L1869), `schema.ts`, `panels.ts`, all touched `.md`s.
- Panels menu (show/hide checkboxes): hiding a tabbed member removes it from its group (and picks a new active); re-showing places it as a new singleton group via `ensurePanelsPlaced`.
- Reset (`handleResetLayout`) returns to `DEFAULT_MAP_LAYOUT` (all singletons). Export/import already carry `groups` from Stage 1; confirm import validation rejects groups referencing unknown/duplicate panels.
- Full companion `.md` pass for every touched source file.
**Done when:** CI green; hide/show, reset, export/import all behave with tabbed groups; every touched `.ts`/`.tsx` has an accurate companion.

## Verification

- **Automated:** `pnpm lint && pnpm typecheck && pnpm build` at each stage. Add unit coverage for `migrateLayout` (v1→v2 singleton derivation), `ensurePanelsPlaced` (missing panel → new singleton group), and the Zod `active ∈ members` refine.
- **Manual (`pnpm dev`):** open a map, then: (1) drag one panel's header onto another → it becomes a tab; (2) click tabs to switch; (3) reorder tabs within the header; (4) drag the group header grip → whole group moves/resizes; (5) tear a tab off into open grid space → ghost shows, drops as its own cell; (6) reload the page → arrangement persists; (7) an account with a pre-existing (v1) saved layout opens unchanged and can then be tabbed; (8) export → import round-trips a tabbed layout; (9) hide/show and reset behave.
- **Regression:** confirm the RGL grip drag and canvas pan/zoom/box-select (`nodrag`/`ap-panel-drag` scoping) are unaffected by the dnd-kit sensors.

## Risks / watch-items

- **Sensor conflict** between dnd-kit and RGL's `react-draggable` — both listen on pointer events in the header. Mitigate by scoping dnd-kit activation to the tab/handle elements and keeping RGL's `handle: .ap-panel-drag` on a distinct grip; use an activation constraint (small distance) so a tab click still switches without starting a drag.
- **Per-breakpoint grouping** means a merge on `lg` shouldn't silently reshape `md`/`sm`. Decide (Stage 3) whether merges apply to the active breakpoint only (recommended) or mirror across all — default: active breakpoint only, matching how RGL geometry is already per-breakpoint.
- **Tear-off coord math** (Stage 4) is the fiddliest; keep the ghost/drop logic isolated in `PanelDndContext`/`MapLayoutGrid` so it's independently testable.
