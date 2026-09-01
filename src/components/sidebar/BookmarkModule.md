## BookmarkModule

**Purpose:** Sidebar panel showing the two bookmark names for the wormhole a viewer's own pilot has just transited, each labelled with the system it belongs in and copyable.
**File:** `src/components/sidebar/BookmarkModule.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| transit | BookmarkTransit \| null | yes | The frozen transit context from `useBookmarkTransit`; `null` ⇒ empty state. |
| signatures | MapSignature[] | yes | Live sigs; filtered to the ones bound to the transit's connection. |

### Renders
A compact card. Before any transit this session: an empty hint. Once a transit resolves: two rows, one per endpoint system (labelled with that system's alias/name), each showing its bookmark name clipped with an ellipsis (full string in the row's `title`) and a copy button. When the active scheme returns no name for the hole, a hint line replaces the rows instead of a disabled control. When either endpoint's signature on this hole hasn't been entered, an additional hint line appears below the rows.

### Behaviour & Interactions
- Pure display — it holds no traversal state. Which transit is shown, and when it changes, is decided by `useBookmarkTransit` (`src/components/map/BookmarkTransitBridge.tsx`).
- **`signatures` is the only live input.** Everything the naming scheme is called with comes from the frozen `transit`, so a graph change alters nothing on screen; the sigs bound to `transit.connection` are filtered from the live list, so binding a signature to either side of the hole re-derives the pair through the naming scheme without disturbing anything else about it.
- **Each row clips for display but copies the full string.** The naming scheme's names are far wider than the panel by design; only the rendered text is clipped (CSS ellipsis) — the underlying string is never truncated, and the copy button always writes the untruncated value.
- Reloading the page clears the panel; it stays empty until the next transit.

### Emits / Calls
- `effectiveBookmarkScheme.names(input)` — the active naming scheme, called with a `BookmarkInput` built from `transit` plus the live signatures bound to its connection.
- `navigator.clipboard.writeText` — on a row's copy button; toasts success/failure via `sonner`.

### Depends On
- `@/lib/bookmarking/scheme` (`effectiveBookmarkScheme`); `BookmarkTransit` (`src/components/map/BookmarkTransitBridge.tsx`).
- `Card`, `Button` (shadcn/ui); `sonner` toast; `lucide-react` `Copy` icon.
