## loadPublicMap.ts

**Purpose:** Turns a public share token into exactly the redacted data an anonymous spectator may see — the single source of `PublicMapViewData`.
**File:** `src/lib/map/loadPublicMap.ts`

---

### loadPublicMapView(token: string): Promise<PublicMapViewData | null>
Resolves the token via `resolveShareToken` (`src/lib/map/share.ts`) and re-loads the map's visible systems, confirmed connections, and (per the token's `ShareRedactionProfile`) signatures and presence. Returns `null` for every unknown/expired/revoked/soft-deleted-parent case, matching `resolveShareToken`'s collapse. A separate function from `loadMapForView` — there is no synthetic anonymous viewer character, and the result is viewer-independent so one payload can be cached and served to every viewer of the token.

Systems reuse `loadStatics` (`src/lib/map/loadMap.ts`) for the static-wormhole display list. Connections apply the same predicate as `loadMapForView`: both endpoints visible and `confirmed_at IS NOT NULL`, so dormant `wh` links and orphan edges stay hidden.

**Endpoint sig IDs:** only queried when `profile.showConnectionSigIds` is set, and only for `wh`-scope connections; k-space gates always carry `sigIds: null`. Each `ap_map_signature` row bound to a connection is matched to its `source` or `target` endpoint by comparing `mapSystemId`; either side may be null when the far side hasn't been pasted yet. Independent of `showSignatures` — this data rides the connection edge, not a signature list.

**Signatures:** only queried when `profile.showSignatures` is set (`null` otherwise, `[]` when set with none present) — a dedicated query, not `loadSignaturesForSystems`, because that helper's row shape carries `description` and `activityOverride`, both excluded here.

**Entrances:** `derivePublicEntrances` (`src/lib/map/publicEntrances.ts`) runs over the projected systems and connections, yielding the k-space ways into the chain with the code to scan and the gate distance to the nearest hub. It also takes the map's Home so each entrance can carry the hop-by-hop way there, when one exists.

**Presence:** branches on `profile.presenceMode`. `none` skips the query. Otherwise loads `loadMapPresence(mapId)` and filters to pilots whose system is actually visible on this map — a tracked pilot located elsewhere must not leak through a public share, since `loadMapPresence` deliberately returns pilots wherever they are. `anonymous` projects to per-system counts plus optional `byClass` buckets, no ids or names. `full` carries the roster minus account linkage (`userId`, `mainCharacterId`, `mainCharacterName`).

### Types
- `PublicMapSystemNode` — `{ id, systemId, name, tag, status, security, trueSec, effect, regionName, constellationName, statics, tradeHub, isHome, positionX, positionY }`. `isHome` marks the map's designated Home (`ap_map.home_map_system_id`), which a guest reads the chain from. Has no `alias`, `intelNotes`, lock fields, or `rallyAt` — those simply are not fields on this type.
- `PublicMapConnectionEdge` — connection scope/mass/EOL/flags plus `sigIds: { source: string | null; target: string | null } | null`. `null` means the token doesn't publish endpoint codes (the hover affordance is absent entirely); a populated object with one side `null` means that side hasn't been scanned yet — the two states are structurally distinct so a consumer can't conflate them.
- `PublicMapSignature` — the signature shape minus `description` and `activityOverride`.
- `PublicPresenceSystemCount` — `{ systemId, count, byClass: { shipClass, count }[] }`.
- `PublicPresencePilot` — the presence entry shape minus account linkage.
- `PublicMapPresence` — discriminated union on `mode`: `{ mode: 'none' }`, `{ mode: 'anonymous'; systems: PublicPresenceSystemCount[] }`, `{ mode: 'full'; pilots: PublicPresencePilot[] }`. The union shape makes "no character name outside `full`" a compile-time property.
- `PublicMapViewData` — `{ map: { name, shareLabel }, systems, connections, signatures, presence, entrances }`. No `id`, `scope`, `type`, `tagScheme`, `notes`, `intel`, `structures`, or stats field exists on this type. Home reaches the payload only as the per-system `isHome` flag, never as a map-level id.

### Depends on
- `@/db/client` (`db`), `@/db/schema` (tables + enums), `@/lib/map/share` (`resolveShareToken`), `@/lib/map/loadMap` (`loadStatics`, `loadMapPresence`), `@/lib/map/publicEntrances` (`derivePublicEntrances`).
