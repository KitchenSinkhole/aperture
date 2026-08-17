## types.ts

**Purpose:** The pure, db-free contract every wormhole-bookmark naming scheme implements, plus the read-only context a scheme names a transit from.
**File:** `src/lib/bookmarking/types.ts`

---

### BookmarkInput
`{ here: MapSystemNode; cameFrom: MapSystemNode; connection: MapConnectionEdge; connections: MapConnectionEdge[]; signatures: MapSignature[]; hopsFromHome: ReadonlyMap<string, number>; homeMapSystemId: string | null }` — the context for naming one wormhole transit. `here` and `cameFrom` are the two endpoints; `connection` is the wormhole between them. `connections` is every connection on the map (including `connection` itself), letting a scheme reason about the chain beyond the hole being crossed. `signatures` holds up to one row per side whose `mapConnectionId` matches `connection.id` — select by `mapSystemId` against each endpoint's `id`. `hopsFromHome` maps `ap_map_system.id` to hop count from Home; a system unreachable from Home, or absent because there is no Home, has no entry. `homeMapSystemId` is the map's Home (`ap_map_system.id`), null when unset.

`MapSystemNode`, `MapConnectionEdge` and `MapSignature` are imported from `@/types` (shaped in `src/lib/map/loadMap.ts`).

### BookmarkScheme
- `names(input): { here: string; cameFrom: string } | null` — the bookmark text to write at each endpoint of the transit. Null is a legitimate answer for a hole the scheme's convention has no name for.
