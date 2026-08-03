## route.ts — GET /api/public/[token]/snapshot

**Purpose:** Serves the redacted `PublicMapViewData` behind a share token — the only endpoint that hands map data to an anonymous client.
**File:** `src/app/api/public/[token]/snapshot/route.ts`

### GET
No session, no cookie, no `mapId`: the token alone selects the map, so a client cannot steer the response at another map.

**Response:** `{ ok: true, data: PublicMapViewData }` — the output of `getPublicSnapshot(token)` (`src/lib/map/publicSnapshot.ts`), which is the cached, viewer-independent projection.

**Responses:** 200 ok, 429 rate-limited, 404 unknown / expired / revoked token. All three token failures answer the same bare 404, so the response never distinguishes "no such token" from "that one was revoked".

The rate limit is checked before the token is resolved, so guessing costs the guesser rather than the database. Every response carries `cache-control: no-store` and `x-robots-tag: noindex` — the payload is public but revocable, so it must never sit in a shared cache the app cannot purge. The client IP is read best-effort from `x-forwarded-for` (first entry) then `x-real-ip`, via the same derivation the public WS upgrade handler uses.

### Depends On
- `getPublicSnapshot`, `allowPublicSnapshotRequest` (`src/lib/map/publicSnapshot.ts`).
- `clientKeyFromForwardedFor` (`src/lib/http/clientKey.ts`).
- `withApiMetrics` (`src/lib/metrics/httpInstrumentation.ts`) — route label `/api/public/:token/snapshot`.
