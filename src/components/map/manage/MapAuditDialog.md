## MapAuditDialog

**Purpose:** Wider dialog hosting the in-map audit console.
**File:** `src/components/map/manage/MapAuditDialog.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| open | boolean | yes | Dialog visibility |
| onOpenChange | (open: boolean) => void | yes | Visibility setter |
| mapId | string | yes | Map whose audit feed is shown |
| mapName | string | yes | Shown in the dialog description |

### Behaviour & Interactions
- Renders `MapAuditBrowser` only while `open`, so its auto-refresh poll doesn't run in the background.
- `DialogContent` is a `max-h-[85vh]` flex column: the header stays fixed and `MapAuditBrowser` grows to fill the remaining height with its own internal scroll, so the dialog never overflows the viewport.
- Launched from the `MapCanvas` toolbar "Audit log" button, which is shown only to holders of the `audit_view` capability; the feed is gated server-side regardless.
