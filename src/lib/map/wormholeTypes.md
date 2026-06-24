## wormholeTypes.ts

**Purpose:** Server-side wormhole-catalog read + connection "mark as static" matching.
**File:** `src/lib/map/wormholeTypes.ts`

> Per-system dropdown grouping (`isStatic` / `matchesClass`) is **not** computed here — the catalog is static, so it's fetched once and annotated on the client via `annotateWormholeTypes` (`wormholeCatalog.ts`). This module only does the DB read and re-exports the option types.

> **Class join key:** `universe_system.security` (the `C1`–`C6` / `H` / `L` / `0.0` labels), **not** `universe_system.security_class`. The catalog's `source_classes`/`target_class` use the same labels as `universe_system.security`, and the seeded catalog + the read-path tests use exactly those. `security_class` is the unrelated SDE ore-spawn field and would never match the catalog — `security` is correct.

---

### jumpMassBand(kg: number | null): WhJumpMass | null
Buckets a wormhole's `wormholeMaxJumpMass` (kg) into the `s`/`m`/`l`/`xl` connection size bands. Thresholds: `≤5M → s`, `≤100M → m`, `<1B → l`, `≥1B → xl` (chosen to sit in the gaps between EVE's discrete jump-mass values — 5M / 62M / 300M·375M / 1B+). `null` in → `null` out. Used by `wormholeCatalog` (to tag each entry) and the signature module's auto-set of a linked connection's size.

---

### wormholeCatalog(): Promise<WormholeCatalogEntry[]>
Returns the **full**, system-independent wormhole catalog ordered by code — every `universe_wormhole` row with its inferred jump-mass band. Static reference data, identical for every system, fed to the global `/api/wormhole-types` route. The per-system `isStatic`/`matchesClass` grouping is derived on the client (`annotateWormholeTypes`), so this read takes no `systemId` and runs no statics query.

- `jumpMassClass` — from the `wormholeMaxJumpMass` dogma value (resolved by name from `universe_dogma_attribute`, read through `universe_type_attribute_effective`), bucketed by `jumpMassBand`. If the attribute name can't be resolved, every `jumpMassClass` is `null` (no join performed).

**Returns:** `WormholeCatalogEntry[]` — `{ typeId, name, sourceClasses, targetClass, jumpMassClass }`.

---

### staticMatchForConnection(args): Promise<StaticMatch[]>
"Mark as static": resolves the target system's `security` class, then matches it against the source system's statics — each `universe_system_static` row joined to `universe_wormhole.target_class`. Returns every static whose destination class equals the target system's class (a system may hold several). Empty when nothing matches or the target class is unknown.

**Parameters:**
- `args.sourceSystemId` — system the connection leaves from (whose statics are checked).
- `args.targetSystemId` — system the connection leads into.

**Returns:** `StaticMatch[]` — `{ typeId, name, targetClass }`.

---

### type WormholeCatalogEntry / WormholeTypeOption / StaticMatch
`WormholeCatalogEntry`/`WormholeTypeOption` live in `wormholeCatalog.ts` (client-safe) and are re-exported here for server callers; `StaticMatch` is defined here. All re-exported from `src/types/index.ts`.

### Depends On
- `universeSystem`, `universeSystemStatic`, `universeWormhole` (Drizzle schema). The static→catalog join mirrors `loadMap.ts` `loadStatics`.
