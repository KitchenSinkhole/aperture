## systemNode.ts

**Purpose:** Pure read-side helper that produces the full `system.added` event body — `ap_map_system` row flattened with `universe_system` + `universe_constellation` + `universe_region` metadata and the system's static wormhole codes. Shared by user-driven mutations (`src/lib/map/mutations/systems.ts`) and the location-poll fold (`src/lib/jobs/locationCommit.ts`).
**File:** `src/lib/map/systemNode.ts`

---

### buildSystemNode(tx, mapSystemId): Promise<MapEventPatch<'system.added'>>
Called inside a `commitMapEvent` `mutate` callback (so the just-inserted/updated row is visible to the transaction's `select`). Returns the patch body matching `mapEventPayloadSchema`'s `system.added` variant — everything the canvas needs to render the node without a follow-up fetch, including `intelNotes`.

`statics` carries the resolved far-side **target class** (`universe_wormhole.target_class ?? name`), matching `loadMap`'s `loadStatics`. Rows with no resolvable class (K162-style) fall back to the raw code and are dropped only when even the code is null. This keeps live-added nodes (location poll / paste) consistent with a full page reload, so the canvas colours statics by class instead of rendering raw WH codes in grey.

`tradeHub` (`{ name, jumps } | null`) mirrors `loadMap`: read from the precomputed `universe_system.nearest_trade_hub_id/jumps` columns and resolved to a hub name via `apertureConfig.ROUTE_HUBS`, so a live-added HS system near a hub shows its proximity badge immediately.

`signatures` (`MapSignature[]`) carries the system's surviving `ap_map_signature` rows (left-joined to `universe_wormhole` for `wormholeCode`, mirroring `loadMapForView`). This rides the single real `system.added` broadcast so re-adding a soft-removed system re-hydrates its signatures on *every* tab without a reload (Bug 1 fix) — surviving rows persist across the `visible=false` cycle. A brand-new add naturally returns `[]`. Connections are deliberately **not** embedded.

### Notes
- **No `import 'server-only'`.** Same precedent as `src/lib/map/mutations/core.ts`: this is a low-level read helper consumed by both user-flow code (where the wrapper layer carries the guard) and job-flow code (plain Node, no `react-server` export condition; would crash on the `server-only/index.js` throw).
- Lives apart from `mutations/systems.ts` because `addSystem` and the location-poll's per-map fold need the same payload shape.
