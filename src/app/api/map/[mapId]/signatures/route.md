## route.ts — POST /api/map/[mapId]/signatures

**Purpose:** Create a scan signature in a map system.
**File:** `src/app/api/map/[mapId]/signatures/route.ts`

### POST
Inserts an `ap_map_signature` row and emits `signature.create`. Returns `{ ok, data, eventId }` where `data` is the full signature body.

**Body:** `{ mapSystemId: string, sigId: string, expiresAt: ISO datetime, mapConnectionId?: string | null, groupKey?, classKind?, typeId?, name?, description? }` — `mapSystemId` and `sigId` are required; `expiresAt` is a required ISO datetime string. `classKind` is `signature` | `anomaly` | null.

**Responses:** 200 ok, 400 mutation error / invalid ids, 401 unauthenticated, 404 map not found.
