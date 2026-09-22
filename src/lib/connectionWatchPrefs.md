## connectionWatchPrefs.ts

**Purpose:** Client-only localStorage store of the connections this device watches on a map, exposed as a subscribable store so the context menu, the edge badge and the sound bridge stay in step.
**File:** `src/lib/connectionWatchPrefs.ts`

A watch is `(mapId, connectionId)` and never leaves the browser. One localStorage key per map holds a JSON object mapping connection id to the epoch-ms instant the watch was set; an empty set removes the key. A watch ends on a `connection.delete` the canvas applies, never on the connection dropping out of a map view, since removing a system hides its connections while the rows survive.

A watch also expires on its own `apertureConfig.WATCHED_CONNECTION_TTL_MS` after it is set, which reclaims an entry whose delete this device never observed (tab closed, a `resync()` that re-seeds from a snapshot without replaying the delete, or a server-side expiry job reaping the hole while nobody is logged in). A hole's remaining life when a watch is placed on it can never exceed one full wormhole lifetime, so the TTL outlives any connection the entry could still refer to. Expiry is applied when a map's snapshot is built, not on a timer, so a watch never disappears mid-session under the cursor of a user looking at its badge; a read that finds expired entries compacts the stored key in place without notifying subscribers, since the snapshot it returns already excludes them. An entry whose value is not a finite number is treated as expired.

A snapshot is cached per map so a canvas full of edges reads the set without re-parsing it, and the cache is invalidated both by writes here and by the `storage` event, so a toggle in another tab on the same device lands without a reload.

---

### watchedConnectionsKey(mapId: string): string
The localStorage key holding one map's watched set (`aperture:map:<mapId>:watched-connections`).

---

### readWatchedConnections(mapId: string): ReadonlySet\<string>
Every unexpired connection watched on that map. Reference-stable between writes, and an empty set on any missing / mistyped / unparsable blob or storage error.

### isConnectionWatched(mapId: string, connectionId: string): boolean
Whether that one connection is watched.

### toggleConnectionWatch(mapId: string, connectionId: string): boolean
Flips the connection's watch, persists the map's set and notifies subscribers. Watching stamps the entry with the current time, starting its TTL.

**Returns:** The resulting watch state.

### dropWatchedConnection(mapId: string, connectionId: string): void
Ends that connection's watch because its hole is gone. Writes and notifies only when the connection was watched, so it is safe to call for any delete.

### subscribeWatchedConnections(listener: () => void): () => void
Registers a change listener; returns an unsubscribe fn. While at least one listener is registered the store tracks the `storage` event.

### useIsConnectionWatched(mapId: string, connectionId: string): boolean
`useSyncExternalStore` hook over `isConnectionWatched`, re-rendering the caller when that connection's watch flips. `false` on the server.
