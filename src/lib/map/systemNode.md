## systemNode.ts

**Purpose:** Pure read-side helpers for the map canvas: `buildSystemNode` produces the `system.added` event body (node metadata + statics), and `loadSignaturesForSystems` loads a system's signatures for on-demand hydration. Shared by user-driven mutations (`src/lib/map/mutations/systems.ts`), the location-poll fold (`src/lib/jobs/locationCommit.ts`), `loadMapForView`, and the per-system signatures endpoint.
**File:** `src/lib/map/systemNode.ts`

---

### buildSystemNode(tx, mapSystemId): Promise<MapEventPatch<'system.added'>>
Called inside a `commitMapEvent` `mutate` callback (so the just-inserted/updated row is visible to the transaction's `select`). Returns the patch body matching `mapEventPayloadSchema`'s `system.added` variant — the node metadata the canvas needs to render, including `intelNotes`. **Signatures are not included** (see `loadSignaturesForSystems`); the event stays a pure delta and the `pg_notify` payload stays under the 8 KB ceiling.

`statics` carries the resolved far-side **target class** (`universe_wormhole.target_class ?? name`), matching `loadMap`'s `loadStatics`. Rows with no resolvable class (K162-style) fall back to the raw code and are dropped only when even the code is null. This keeps live-added nodes (location poll / paste) consistent with a full page reload, so the canvas colours statics by class instead of rendering raw WH codes in grey.

`tradeHub` (`{ name, jumps } | null`) mirrors `loadMap`: read from the precomputed `universe_system.nearest_trade_hub_id/jumps` columns and resolved to a hub name via `apertureConfig.ROUTE_HUBS`, so a live-added HS system near a hub shows its proximity badge immediately.

### loadSignaturesForSystems(mapSystemIds): Promise<MapSignature[]>
The single source of the signature row shape: `ap_map_signature` rows for the given map systems, LEFT JOINed to `universe_wormhole` for `wormholeCode`, ordered by `sigId`. Reads the pooled `db` directly (both callers run outside a transaction); returns `[]` for an empty id set. Used by `loadMapForView` (the whole visible set) and `GET …/systems/[mapSystemId]/signatures` (one id, for the canvas's re-add hydration). Re-adding a soft-removed system no longer carries sigs on the `system.added` broadcast — instead the canvas refetches them via this endpoint on the event, so all tabs converge without a reload while the event stays small.

### Notes
- **No `import 'server-only'`.** Same precedent as `src/lib/map/mutations/core.ts`: this is a low-level read helper consumed by both user-flow code (where the wrapper layer carries the guard) and job-flow code (plain Node, no `react-server` export condition; would crash on the `server-only/index.js` throw).
- Lives apart from `mutations/systems.ts` because `addSystem` and the location-poll's per-map fold need the same payload shape.
