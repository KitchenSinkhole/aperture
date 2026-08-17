## BookmarkModule

**Purpose:** Sidebar panel showing the two bookmark names for the wormhole a viewer's own pilot has just transited, each labelled with the system it belongs in and copyable.
**File:** `src/components/sidebar/BookmarkModule.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| systems | MapSystemNode[] | yes | Live placed systems; resolves EVE ids → map systems. |
| connections | MapConnectionEdge[] | yes | Live edges; used to find the folded WH connection and rule out gate jumps. |
| signatures | MapSignature[] | yes | Live sigs; filtered to the ones bound to the resolved connection. |
| homeMapSystemId | string \| null | yes | `viewData.map.homeMapSystemId` — feeds `hopsFromHome`. |
| viewerCharacters | { id: number; name: string }[] | yes | The viewer's own characters — only their jumps produce a pair. |

### Renders
A compact card. Before any transit this session: an empty hint. Once a transit resolves: two rows, one per endpoint system (labelled with that system's alias/name), each showing its bookmark name clipped with an ellipsis (full string in the row's `title`) and a copy button. When the active scheme returns no name for the hole, a hint line replaces the rows instead of a disabled control. When either endpoint's signature on this hole hasn't been entered, an additional hint line appears below the rows.

### Behaviour & Interactions
- Subscribes via `useTraversals` (must be rendered inside `MapPresenceProvider`); ignores jumps whose `characterId` isn't one of `viewerCharacters`.
- A jump that can't yet be resolved against `systems`/`connections` (the connection hasn't folded into client state) is held and retried against live props on every render until it resolves or the buffer expires (`BUFFER_TTL_MS`, 3s). A `stargate` connection between the two systems means a gate jump and is ignored entirely, leaving any previously displayed pair untouched.
- **The displayed pair is a snapshot, held rather than re-derived.** Once a transit resolves to a `wh` connection, the endpoint systems, the connection, the full `connections` list, `hopsFromHome`, and `homeMapSystemId` are captured and frozen; further changes to `systems`/`connections` do not alter the displayed pair. The sole exception is `signatures`: the sigs bound to the resolved connection are read live, so binding a signature to either side of the hole re-derives the pair through the naming scheme without disturbing anything else about it. A new qualifying transit replaces the displayed pair entirely.
- **Each row clips for display but copies the full string.** The naming scheme's names are far wider than the panel by design; only the rendered text is clipped (CSS ellipsis) — the underlying string is never truncated, and the copy button always writes the untruncated value.
- Reloading the page clears the panel; it stays empty until the next transit.

### Emits / Calls
- `useTraversals(cb)` — subscribes to pilot jumps from `MapPresenceContext`.
- `effectiveBookmarkScheme.names(input)` — the active naming scheme, called with a `BookmarkInput` built from the frozen snapshot plus the live signatures bound to its connection.
- `hopsFromHome({ systems, connections, homeId })` — computed once, at the moment a transit resolves.
- `navigator.clipboard.writeText` — on a row's copy button; toasts success/failure via `sonner`.

### Exports
- `resolveBookmarkTransit(jump, systems, connections)` — pure resolver (jump → the incident `wh` connection, `drop` for a gate jump, `pending` while the fold hasn't landed), unit-testable without React.

### Depends On
- `MapPresenceContext` (`useTraversals`).
- `@/lib/bookmarking/scheme` (`effectiveBookmarkScheme`), `@/lib/map/subchainGraph` (`hopsFromHome`).
- `Card`, `Button` (shadcn/ui); `sonner` toast; `lucide-react` `Copy` icon.

### Local State
- `pending: { characterId, fromSystemId, toSystemId, at } | null` — the latest own-pilot jump not yet resolvable against live props; `at` (ms epoch) drives the `BUFFER_TTL_MS` expiry timer.
- `snapshot: { here, cameFrom, connection, connections, hopsFromHome, homeMapSystemId } | null` — the frozen transit context the displayed pair is derived from; `null` before the session's first qualifying transit.
