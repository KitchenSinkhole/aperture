## wormholeJumpInfo.ts

**Purpose:** Server-side read of the wormhole jump reference catalog (code, classes, mass, lifetime, sig strength) for the Jump Info dialog.
**File:** `src/lib/eve/wormholeJumpInfo.ts`

`import 'server-only'` — DB-backed; not importable from client code.

---

### wormholeJumpInfo(): Promise<WormholeJumpInfoRow[]>
Returns every row in `universe_wormhole` ordered by code, each joined with its dogma mass/lifetime/sig-strength.

- Routing fields (`code`, `sourceClasses`, `targetClass`) come from `universe_wormhole`. `sourceClasses` is a `string[] | null` (the set of classes the hole spawns in; null = source unspecified).
- `totalMass` / `jumpMass` / `lifetimeMinutes` / `sigStrength` come from the `universe_type_attribute_effective` view (so the attr-3974 sig-strength override is applied). Attribute ids are resolved by name (`wormholeMaxStableMass`, `wormholeMaxJumpMass`, `wormholeMaxStableTime`, `scanWormholeStrength`) from `universe_dogma_attribute`; an unresolved name yields `null` for that column rather than throwing.

**Returns:** `WormholeJumpInfoRow[]` — `{ typeId, code, sourceClasses, targetClass, totalMass, jumpMass, lifetimeMinutes, sigStrength }`. `typeId` (`universe_wormhole.type_id`) lets a caller look a row up by id rather than matching on the code string. Re-exported from `src/types/index.ts`.
