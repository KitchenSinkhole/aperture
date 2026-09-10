## BookmarkTransitBridge

**Purpose:** Tracks the wormhole the viewer's own pilots have most recently crossed and freezes its context for the Bookmarks panel.
**File:** `src/components/map/BookmarkTransitBridge.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| onTraversal | (t: Traversal) => void | yes | The handler returned by `useBookmarkTransit`, subscribed to pilot jumps. |

### Renders
Nothing. It exists so the traversal subscription sits inside `MapPresenceProvider` while the state it feeds is owned by the always-mounted component above it — a panel tabbed away or hidden therefore misses no transit.

### Emits / Calls
- `useTraversals(onTraversal)` — subscribes to pilot jumps from `MapPresenceContext`.

### Depends On
- `MapPresenceContext` (`useTraversals`, `Traversal`; must be rendered inside `MapPresenceProvider`).

---

## useBookmarkTransit(args): { transit, onTraversal }

A hook for the owner of the Bookmarks panel's state. `args` is `{ systems, connections, homeMapSystemId, viewerCharacters }` — the live map graph and the viewer's own characters.

**Returns:**
- `transit: BookmarkTransit | null` — the frozen context of the last qualifying transit; `null` before the first one.
- `onTraversal: (t: Traversal) => void` — hand to `BookmarkTransitBridge`.

### Behaviour
- A traversal whose `characterId` is not one of `viewerCharacters` is ignored.
- A `stargate` connection between the two endpoints means a gate jump: it is ignored entirely and leaves any currently held transit untouched.
- A jump that cannot yet resolve against `systems`/`connections` (the `connection.create` has not folded into client state) is held as `pending` and retried against live props on every render until it resolves, drops, or `BUFFER_TTL_MS` (3s) elapses. Only one jump is held; a fresh own-pilot jump replaces it.
- The retry adjusts state during render rather than in an effect, so a resolving jump promotes in the same render pass; clearing `pending` makes the branch a no-op on the next render.
- **Once a transit resolves, its context is captured and frozen.** `here`, `cameFrom`, `connection`, the whole `connections` list, `hopsFromHome`, and `homeMapSystemId` are taken together at that moment and do not re-derive as the graph shifts. A new qualifying transit replaces the whole thing.

### Exports
- `BookmarkTransit` (type) — `{ here, cameFrom, connection, connections, hopsFromHome, homeMapSystemId }`, the frozen capture consumed by `BookmarkModule`.

### Depends On
- `@/lib/map/transitResolve` (`resolveTransit`, `BUFFER_TTL_MS`), `@/lib/map/subchainGraph` (`hopsFromHome`).

### Local State
- `pending: { fromSystemId, toSystemId, at } | null` — the latest own-pilot jump not yet resolvable against live props; `at` (ms epoch) drives the `BUFFER_TTL_MS` expiry timer.
- `transit: BookmarkTransit | null` — the frozen capture the panel renders from.
