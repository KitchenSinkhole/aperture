## thera.ts

**Purpose:** Thera module backend — read EVE-Scout's Thera/Turnur feed and fold chosen connections onto a map.
**File:** `src/lib/map/thera.ts` (`server-only`)

---

### loadTheraConnections(): Promise<TheraConnection[]>
Fetch the current EVE-Scout Thera + Turnur connections (via the `fetchEveScoutConnections` client, fronted by a 60s module-level TTL cache), orient each row so the shattered hub is the source and the connected system the target, and enrich the target with its `universe_system.security` class label (one `inArray` query).

**Returns:** `TheraConnection[]` — `{ hub, hubSystemId, hubName, targetSystemId, targetName, securityClass, signatureId, expiresAt }`. Rows EVE-Scout couldn't resolve to system ids are dropped. Throws `EveScoutError` on an EVE-Scout failure.

---

### syncTheraConnections(args): Promise<ActionResult<TheraSyncResult>>
Fold the chosen connections onto a map. Groups targets by hub; ensures the hub + each target system visible and a `wh`/`fresh` connection per pair, all under one `db.transaction` (mirrors `importMapData`). Idempotent: skips a system already `visible` and a connection that already links the pair in either direction (mirrors `locationCommit`). New systems are positioned by fanning targets radially around the hub. Auto-tagging: ABC rides in `system.added` via `assignTagOnAdd`; the 0121 child tag is emitted as a best-effort follow-up `system.updated` after commit via `assignTagOnConnect` (a tag failure is logged at `warn` via the structured logger [[logger]] and never fails the sync).

**Parameters:**
- `mapId` — target map.
- `characterId` — audit FK (null when actor erased).
- `connections` — `TheraSyncInput[]` (`{ hubSystemId, hubName, targetSystemId, signatureId? }`).

**Returns:** `ActionResult<{ summary: { systems, connections }; payloads: MapEventPayload[] }>` — the committed event payloads for the client to fold + dedupe (wrapper-level `eventId` is always `0`, like the bulk-paste / import paths).

---

### Types
- `TheraHub` — `'Thera' | 'Turnur'`.
- `TheraConnection` — oriented + enriched EVE-Scout row (re-exported from `src/types`).
- `TheraSyncInput` — one connection to sync.
- `TheraSyncResult` — `{ summary, payloads }`.
