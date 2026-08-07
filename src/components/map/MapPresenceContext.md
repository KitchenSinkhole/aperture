## MapPresenceContext.tsx

**Purpose:** Client-side store for "which tracked pilots are in which system on this map". Seeds from the SSR'd `MapViewData.presence`, then folds incoming realtime `characterUpdate` envelopes on top. Each `SystemNode` subscribes only to its own system's slice so a single character moving re-renders at most two nodes.
**File:** `src/components/map/MapPresenceContext.tsx`

---

### MapPresenceProvider

Wraps the canvas subtree. Owns one `PresenceStore` instance.

**Props:**
| Prop | Type | Required | Description |
|---|---|---|---|
| initial | MapPresenceEntry[] | yes | The server-loaded initial roster from `loadMapPresence` (via `MapViewData.presence`). |
| children | ReactNode | yes | The canvas subtree. |

The provider seeds the store synchronously inside `useState`'s init so the first paint already shows badges; an effect re-seeds when the `initial` reference actually changes (e.g. soft navigation back to this map). It also registers a `useRealtimeEvents` listener: it calls `store.apply()` for every parsed `characterUpdate` envelope and `store.remove()` for every parsed `characterLogout` envelope — every envelope is delivered exactly once (no `lastEvent` coalescing), so a burst of presence updates in one tick all fold in rather than dropping to the last. `apply()` copies the account/main identity (`userId`/`mainCharacterId`/`mainCharacterName`) from the load onto the rebuilt entry, so the roster keeps grouping alts under their main across live moves.

Unlike `MapCanvas`/`MapUnderglowBridge`/`ConnectionMassLog`, this provider has no client-side foreign-map guard: `characterUpdateLoadSchema`'s load carries no `mapId` (a pilot's presence isn't scoped to a single map in the payload), so there is nothing in the `load` to check it against. It relies entirely on the SharedWorker routing each `characterUpdate` envelope only to ports subscribed to its source map.

### usePresenceForSystem(systemId: number): readonly MapPresenceEntry[]

Hook returning the pilot list for one EVE solar-system. Returns a stable array reference until that system's slice changes (`useSyncExternalStore` semantics). Returns the module-level `EMPTY` array when the system has no pilots or the hook is used outside a provider (cheap no-op on read-only routes).

### usePresenceForMap(): readonly MapPresenceEntry[]

Hook returning every online + located pilot across the whole map, sorted by name. Subscribes to the store's map-wide subscriber set, so it re-renders whenever any system's slice changes. The flattened snapshot is cached on the store (rebuilt only on mutation) to satisfy `useSyncExternalStore`'s stable-reference requirement. Used by `MapInfoDialog` for the online-pilot count and the Pilots roster.

### usePresenceStore(): PresenceStore | null

Returns the presence store instance for callers that need to read it live at event time rather than subscribe to a slice. The instance is stable for the provider's lifetime; null outside a provider. Used by `SignaturePasteHotkey` to check, at paste time, whether any of the viewer's characters is located in the selected system (via `getSystemForCharacter`).

### useTraversals(cb: (t: Traversal) => void): void

Subscribes to pilot jumps. The store emits a `Traversal` (`{ characterId, fromSystemId, toSystemId, at }`, solar-system ids) whenever `apply()` folds a `characterUpdate` that moves an online + located pilot from one system to a *different* located system. Seed/offline transitions and same-system re-reports don't emit. The callback is held in a ref so it can change every render without re-subscribing. Consumed by `MapTravelContext`'s `TravelBridge` to drive the connection travel animation.

### Traversal (type)

`{ characterId: number; fromSystemId: number; toSystemId: number; at: string }` — a detected jump, keyed by EVE solar-system id (`at` is the ISO detection timestamp).

### Behaviour
- **Offline pilots are hidden.** The store only inserts an entry when `online === true && systemId !== null && locationAt !== null`. An envelope with any of those falsy removes the character from their prior system (if any) and inserts nothing.
- **Sorted by character name** within each system, so the hover list renders deterministically.
- **Re-seed (full replace)** notifies every previously-present *and* currently-present system — so a system that lost all its pilots between server-load snapshots still re-renders to empty.
- **`characterLogout` removal.** A `characterLogout` envelope drops the named pilots from every system slice outright (server-revoked access after leaving the owning corp/alliance) — unlike an offline `characterUpdate`, there is no breadcrumb to retain.

### PresenceStore (exported)

The store class is exported for unit testing. Relevant methods beyond the internal subscribe/notify plumbing: `seed(initial)`, `apply(load)`, `remove(characterIds)` (drop pilots outright on a `characterLogout`), `getForSystem(id)`, `getAll()`, and `getSystemForCharacter(characterId)` (the EVE system id that character is online+located in, else null — read live for the CTRL+V location check).

### Depends On
- `@/lib/map/loadMap` (`MapPresenceEntry` type)
- `@/lib/realtime/protocol` (`characterUpdateLoadSchema`, `characterLogoutLoadSchema`, `CharacterUpdateLoad`, `Envelope`)
- `@/lib/realtime/useRealtime` (`useRealtimeEvents`)
