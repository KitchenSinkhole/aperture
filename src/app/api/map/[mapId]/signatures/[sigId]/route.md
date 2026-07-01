## route.ts — PATCH/DELETE /api/map/[mapId]/signatures/[sigId]

**Purpose:** Update or hard-delete a scan signature. `[sigId]` is `ap_map_signature.id` (the DB row id, not the in-game sig code).
**File:** `src/app/api/map/[mapId]/signatures/[sigId]/route.ts`

### PATCH
Updates only the fields present in the body. Ownership validated through `apMapSystem.mapId`. Returns `{ ok, data, eventId }` where `data` is the `signature.update` patch.

**Body:** `{ mapConnectionId?: string | null, sigId?, groupKey?, classKind?, activityOverride?, typeId?, eolStage?, name?, description?, expiresAt? }` — all optional. `classKind` is `signature` | `anomaly` | null; `activityOverride` is `combat` | `exploration` | null (manual site-safety override; null clears it back to the derived value). `eolStage` is `none` | `eol` | `critical` (pre-jump EOL stage). `mapConnectionId` and `expiresAt` are a bigint string and ISO datetime string respectively.

### DELETE
Hard-deletes the signature row. Returns `{ ok, data, eventId }` where `data` is the `signature.delete` payload.

**Responses:** 200 ok, 400 mutation error / invalid id, 401 unauthenticated, 404 map not found.
