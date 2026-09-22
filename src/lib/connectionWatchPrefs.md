## connectionWatchPrefs.ts

**Purpose:** Client-only localStorage store of the connections this device watches on a map, exposed as a subscribable store so the context menu, the edge badge and the sound bridge stay in step.
**File:** `src/lib/connectionWatchPrefs.ts`

A watch is `(mapId, connectionId)` and never leaves the browser. One localStorage key per map holds a JSON array of connection ids; an empty set removes the key. A watch ends on a `connection.delete` the canvas applies, never on the connection dropping out of a map view, since removing a system hides its connections while the rows survive. The store itself has no other expiry: a delete this device never observed leaves its entry behind, harmlessly — `ap_map_connection.id` is `generated always as identity` and a hard-deleted id never returns, so a stale entry can match nothing. A snapshot is cached per map so a canvas full of edges reads the set without re-parsing it, and the cache is invalidated both by writes here and by the `storage` event, so a toggle in another tab on the same device lands without a reload.

---

### watchedConnectionsKey(mapId: string): string
The localStorage key holding one map's watched set (`aperture:map:<mapId>:watched-connections`).

---

### readWatchedConnections(mapId: string): ReadonlySet\<string>
Every connection watched on that map. Reference-stable between writes, and an empty set on any missing / mistyped / unparsable blob or storage error.

### isConnectionWatched(mapId: string, connectionId: string): boolean
Whether that one connection is watched.

### toggleConnectionWatch(mapId: string, connectionId: string): boolean
Flips the connection's watch, persists the map's set and notifies subscribers.

**Returns:** The resulting watch state.

### dropWatchedConnection(mapId: string, connectionId: string): void
Ends that connection's watch because its hole is gone. Writes and notifies only when the connection was watched, so it is safe to call for any delete.

### subscribeWatchedConnections(listener: () => void): () => void
Registers a change listener; returns an unsubscribe fn. While at least one listener is registered the store tracks the `storage` event.

### useIsConnectionWatched(mapId: string, connectionId: string): boolean
`useSyncExternalStore` hook over `isConnectionWatched`, re-rendering the caller when that connection's watch flips. `false` on the server.
