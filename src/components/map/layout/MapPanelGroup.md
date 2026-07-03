## MapPanelGroup

**Purpose:** Chrome for one grid cell — a group of member panels shown as a header tab strip over the active tab's body. A single-visible-member group renders as an untabbed panel (title + hide button).
**File:** `src/components/map/layout/MapPanelGroup.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| group | PanelGroup | yes | The cell's members (tab order) and active tab; `group.id` is the grid item `i` |
| hidden | PanelId[] | yes | Flat hidden set; a member in it is dropped from the tab strip |
| onSetActive | (groupId: string, panel: PanelId) => void | yes | Called when a tab is clicked to switch the active member |
| onHideMember | (panel: PanelId) => void | yes | Called by a tab's close (✕), or the singleton hide button, to hide that panel |
| renderContent | (id: PanelId) => ReactNode | yes | Renders the active member's body |
| renderHeaderRight | (id: PanelId) => ReactNode | yes | Renders header actions for the active member (right of the tabs) |
| contentClassName | (id: PanelId) => string \| undefined | no | Resolves the body class for the active member; the canvas passes `overflow-hidden` so ReactFlow fills a padding-free cell |

### Renders
A full-height `Card` (`gap-0 py-0`) with a thin header bar and a body. The header holds a grip icon then either a single truncated title (one visible member) or a horizontal tab strip (one tab per visible member: title + close ✕, active tab highlighted), followed by the active member's `renderHeaderRight` and — only in the single-member case — a whole-panel hide (✕) button. The body renders `renderContent(active)`.

### Behaviour & Interactions
- The active member is `group.active` when it is still visible, else the first visible member.
- Members present in `hidden` are excluded from the tab strip; a group with no visible members renders nothing (callers filter these out first).
- The whole header carries `PANEL_DRAG_HANDLE_CLASS` (`ap-panel-drag`), so dragging the header background moves the entire cell; the tab strip and the right-hand controls are wrapped in `PANEL_NO_DRAG_CLASS` (`nodrag`) so tab clicks and buttons don't start a drag.
- **Card-in-card dedupe:** the body carries `[&>[data-slot=card]]:rounded-none [&>[data-slot=card]]:ring-0`, so a module rendering its own `<Card>` as the body's direct child loses that card's frame and the panel reads as a single card. The canvas body is a plain div, so the variant doesn't match it.
- RGL's resize handle is a sibling of the `Card` inside the grid item, so the card's `overflow-hidden` does not clip it.

### Exports
- `MapPanelGroup` — the component.
- `PANEL_DRAG_HANDLE_CLASS` / `PANEL_NO_DRAG_CLASS` — shared with `MapLayoutGrid` to wire the grid's drag handle/cancel selectors.

### Depends On
- `Card` (`@/components/ui/card`), `Button` (`@/components/ui/button`), lucide `GripVertical` / `X`.
- `PANELS` (`@/lib/map/layout/panels`) — resolves member titles.
