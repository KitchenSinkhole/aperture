## wormholeCatalog.ts

**Purpose:** Client-safe wormhole-catalog types + per-system annotation; lets the dropdown derive class grouping locally instead of re-fetching the catalog per system.
**File:** `src/lib/map/wormholeCatalog.ts`

No `import 'server-only'` — imported by client components. The DB read producing the catalog lives in `wormholeTypes.ts` (`wormholeCatalog()`).

---

### type WormholeCatalogEntry
One immutable catalog row, identical for every system: `typeId`, `name`, `sourceClasses` (`string[] | null`), `targetClass` (`string | null`), `jumpMassClass` (`WhJumpMass | null`).

### type WormholeTypeOption
`WormholeCatalogEntry` plus the two per-system flags `isStatic` and `matchesClass`. Produced by `annotateWormholeTypes`.

---

### annotateWormholeTypes(catalog: WormholeCatalogEntry[], system: { security: string | null; staticTypeIds: number[] }): WormholeTypeOption[]
Pure function. Tags each catalog entry with `isStatic` (entry's `typeId` is in the system's static set) and `matchesClass` (`sourceClasses == null`, or contains `system.security`, or `isStatic`). The static clause keeps a shattered system's odd-class statics visible by default.

**Parameters:**
- `catalog` — the full static catalog (fetched once via `fetchWormholeCatalog`).
- `system.security` — the host system's class label (`MapSystemNode.security`).
- `system.staticTypeIds` — the host system's static `universe_wormhole.type_id` set (`MapSystemNode.staticTypeIds`).

**Returns:** The catalog annotated for that system, preserving input order.
