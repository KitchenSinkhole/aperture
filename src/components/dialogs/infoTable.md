## infoTable.tsx

**Purpose:** Shared scroll-table primitives used by the Map info dialog panels and the pilot roster popover — styled table elements, no state.
**File:** `src/components/dialogs/infoTable.tsx`

---

### InfoTable({ children })
A full-width `text-xs` `<table>`. Pass `<thead>`/`<tbody>` as children. Render bare for a non-scrolling table, or wrap in `ScrollTable` for a height-capped, bordered scroll region.

### ScrollTable({ children })
A `max-h-[60vh]` bordered (`rounded-md ring-1`) scroll container. Wrap an `InfoTable` in it. (No longer provides the `<table>` itself — that's `InfoTable`.)

### Th({ className, children })
Left-aligned `<th>` cell with the standard padding/weight. `className` extends.

### Td({ className, children })
`<td>` cell with the standard padding. `className` extends.

### EmptyRow({ children })
Centered muted empty-state block (not a table row — render in place of `ScrollTable`).

---

### Consumed by
- `MapInfoDialog` (Systems / Connections panels — `ScrollTable` + `InfoTable`)
- `PilotRosterTable` (wraps `InfoTable` in `ScrollTable` only when `scrollable`; `SystemNode`'s presence popup renders it bare)
