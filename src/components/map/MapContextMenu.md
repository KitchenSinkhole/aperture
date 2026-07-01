## MapContextMenu

**Purpose:** Cursor-anchored right-click context menu for the map canvas, exposing every no-text-input system / connection / note / pane action without opening the inspector.
**File:** `src/components/map/MapContextMenu.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| target | MapContextMenuTarget \| null | yes | The right-clicked target (kind + id + cursor x/y). `null` ⇒ menu closed. |
| onClose | () => void | yes | Called when the menu requests to close (outside click, Escape, item select). |
| systems | MapSystemNode[] | yes | Live system rows; the `system` target is resolved by `id` from here. |
| connections | MapConnectionEdge[] | yes | Live connection rows; the `connection` target is resolved by `id` from here (also used to list a head's neighbours for the no-Home subchain submenu). |
| homeMapSystemId | string \| null | yes | The map's designated Home. Drives the subchain entry: single-click when set, keep-side submenu when null; the Home node itself shows no subchain item. |
| selectedSystemIds | Set\<string> | yes | Current multi-selection. When the right-clicked system is in it (size > 1), "Remove from map" acts on the whole group. |
| onSystemPatch | (id: string, patch: UpdateSystemBody) => void | yes | Commits a system field change (optimistic in `MapCanvas`). |
| onSystemRemove | (id: string) => void | yes | Removes the single right-clicked system from the map. |
| onSystemRemoveSelected | () => void | yes | Removes the entire current multi-selection (mirrors the Delete key / floating "Remove N" button). |
| onConnectionPatch | (id: string, patch: UpdateConnectionBody) => void | yes | Commits a connection field change. |
| onConnectionDelete | (id: string) => void | yes | Deletes the connection. |
| onAddSystemAt | (clientX: number, clientY: number) => void | yes | Opens the add-system dialog targeting the clicked client point. |
| onDeleteSubchain | (headId: string) => void | yes | Home-anchored delete-subchain: delete this head + its branch (Home is the keep-side). |
| onDeleteSubchainPick | (headId: string, anchorId: string) => void | yes | No-Home fallback: delete this head, keeping the chosen neighbour's side. |
| onDeleteDisconnected | () => void | yes | Pane action: delete every system disconnected from the Home. |
| onPingSystem | (id: string) => void | yes | Broadcasts a transient attention "ping" pulse on the system to all map viewers. |
| notes | MapNote[] | yes | Live note rows; the `note` target is resolved by `id` from here. |
| onAddNoteAt | (clientX: number, clientY: number) => void | yes | Pane action: create a note at the clicked client point. |
| onNotePatch | (id: string, patch: UpdateNoteBody) => void | yes | Commits a note field change (severity / locked). |
| onNoteRemove | (id: string) => void | yes | Deletes the note (hard). |

### Renders
A Base UI menu popup anchored to the cursor point, with per-kind items:

- **system** — `Ping` (Radar icon) broadcasts a short attention pulse on the node to every map viewer (via `onPingSystem`); `Set destination` (Navigation icon) appends the system as an autopilot waypoint on the active character's in-game route (disabled when no character is active); `Status ▸` radio submenu (`SYSTEM_STATUSES`); `Set rally` / `Clear rally` toggle; `Locked` checkbox; separator; destructive `Remove from map` (labelled `Remove N from map` and removing the whole selection when the right-clicked system is part of a multi-selection); then the delete-subchain entry (hidden when the target is the Home node): with a Home set, a single destructive `Delete subchain`; without a Home, a `Delete subchain ▸` submenu listing the head's neighbours as `Keep <label>` (disabled when the head has no connections).
- **Locked-system delete guard (UI mirror of the server guard).** A locked system can't be removed (server rejects it — issue #157), so every delete entry computes the locked subset client-side and greys out rather than failing on the round-trip, via the shared `DisabledHintItem` (a two-line non-interactive row whose muted second line is `formatLockedHint(names)`, naming the locked system(s)). Specifically: a lone locked `Remove from map` greys with `<name> is locked — unlock it to delete`; a multi-selection `Remove from map` removes only the deletable systems, shows `Remove <deletableCount> from map` with a trailing `(<n> locked)` note, and greys entirely when nothing is deletable; `Delete subchain` (both the Home-anchored item and each no-Home `Keep <label>` option) greys when its resolved `computeSubchain` set traps a locked system; the pane `Delete disconnected` greys when the `computeDisconnected` set contains a locked system. The deletable counts/sets exclude the Home as well as locked systems, matching the floating "Remove N" button.
- **connection** — `Mass ▸` (`WH_MASSES` via `WH_MASS_LABELS`), `Jump mass ▸` (`unknown` + `WH_JUMP_MASSES`), `Type ▸` (`CONNECTION_SCOPES`), `EOL ▸` (`EOL_STAGES` via `EOL_STAGE_LABELS`) radio submenus; `Preserve mass` / `Rolling` / `Static` checkboxes (`Static` designates the link as the source system's static — drives the ABC home-static exemption); separator; destructive `Delete connection`.
- **note** — `Severity ▸` radio submenu (`NOTE_SEVERITIES` via `NOTE_SEVERITY_LABELS`); `Locked` checkbox; separator; destructive `Delete note`. The Delete entry greys (via `DisabledHintItem`, hint "Unlock the note to delete it") when the note is locked — locking protects a note from both dragging and deletion (the server has no locked-delete guard, so this is a client-side protection mirroring the inspector's disabled Remove).
- **pane** — `Add system`; `Add note here` (StickyNote icon → `onAddNoteAt`); plus a destructive `Delete disconnected` (Unlink icon) shown only when a Home is set **and** `computeDisconnected` finds ≥1 system cut off from it (otherwise the action is a no-op, so it's hidden). Greyed via `DisabledHintItem` when any disconnected system is locked.

If the target id no longer resolves (realtime removed it), a single disabled "… not found" item is shown.

### Behaviour & Interactions
- Built on **`ContextMenu.Root`** (Base UI), not raw `Menu.Root`. This puts the menu in context-menu mode (`parent.type === 'context-menu'`), which gates the open/dismiss lifecycle — outside-press grace period and the `allowMouseEnter` flag that submenu hover-open depends on. A raw `Menu.Root` stays in dropdown mode and collapses the moment submenu hover machinery engages, so the submenu-bearing system/connection menus would vanish on pointer move (the submenu-free pane menu survived either way). Open + positioning are still driven by us.
- Controlled via `open={target !== null}`; `onOpenChange(false)` → `onClose`. No manual document listeners.
- Positioned with a **virtual anchor** (`getBoundingClientRect` returning a zero-size rect at `target.x`/`target.y`), opening `side="right"` / `align="start"` from the cursor like a native menu.
- Right-click does **not** change map selection — the menu carries `target.id` directly. Because of this, `Remove from map` checks `selectedSystemIds`: if the right-clicked system is in a multi-selection it removes the whole group (`onSystemRemoveSelected`); right-clicking a system outside the selection removes only that one.
- Every leaf action invokes its callback **and** `onClose()`, so the menu closes after each pick (radio/checkbox close via the patch callback calling `onClose`).
- Jump-mass uses the `__none__` sentinel (rendered "unknown") to mean `jumpMassClass: null`, mirroring `InspectorModule.tsx`.
- **Ping** is broadcast, not local: `onPingSystem(id)` (wired by `MapCanvas` to `pingSystemOnServer`) POSTs `/api/map/[mapId]/ping`, which fans a `systemNotification` (kind `ping`) to all viewers. The pulse renders for everyone — the initiator included — via `MapUnderglowBridge`, so there is no optimistic local trigger here.
- **Set destination** is self-contained, not a parent callback: the `SetDestinationItem` sub-component reads `activeCharId` and `locatedChars` from `useMapActiveChar()` (the active character isn't available to `MapCanvas`, which renders *above* `MapActiveCharProvider`; the menu renders *inside* it) and POSTs `/api/character/waypoint` via `setWaypointOnServer`. Three branches: 0 located chars → disabled item; 1 located char → direct action (no submenu); 2+ located chars → submenu with an "All characters" fan-out entry (using `Promise.allSettled`) plus a per-character list (active char bolded). On success it toasts `Waypoint set to <label>` or a count summary for multi-char fan-out (errors are toasted by `requestJson`). It calls `onClose` itself — hence `SystemItems` now also takes an `onClose` prop.
- Row text is column-aligned: submenu triggers and plain items pass `inset`, and destructive/add items pass their leading icon via the `icon` prop, so they share the same left gutter as the `Locked` / `Preserve mass` / `Rolling` checkbox items.

### Depends On
- `@/components/ui/menu` — `MenuItem`, `MenuSubmenu`, `MenuSubmenuTrigger`, `MenuSubmenuContent`, `MenuRadioGroup`, `MenuRadioItem`, `MenuCheckboxItem`, `MenuSeparator`.
- `./SetDestinationItem` — renders the "Set destination" menu item (including waypoint API call and character selection).
- `@base-ui/react/context-menu` — `ContextMenu.Root` for the context-menu-mode root (controlled `open` + virtual anchor).
- `@base-ui/react/menu` — `Portal` / `Positioner` / `Popup` for the cursor-anchored popup (styling mirrors `MenuContent`).
- `@/lib/map/enumLabels` — enum value lists + EOL labels and their types.
- `@/lib/map/subchainGraph` — `neighborsOf` for the no-Home keep-side submenu; `computeDisconnected` to decide whether the pane `Delete disconnected` item shows; `computeSubchain` to resolve each delete-subchain set for the locked-system grey-out.
- `MapContextMenuTarget`, `MapSystemNode`, `MapConnectionEdge`, `MapNote` (`@/types`); `UpdateSystemBody`, `UpdateConnectionBody`, `UpdateNoteBody` (`@/lib/map/client`).
