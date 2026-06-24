## mass-log/route.ts

**Purpose:** Read-only API for a connection's per-jump mass-log.
**File:** `src/app/api/map/[mapId]/connections/[connId]/mass-log/route.ts`

### GET /api/map/[mapId]/connections/[connId]/mass-log
Returns `{ ok: true, data: ConnectionMassLogEntry[] }` — the connection's logged jumps newest-first,
each with a chronological running cumulative mass (see `listConnectionMassLog` in
`src/lib/map/connectionMassLog.ts`).

- **Access:** `requireMapView` (view right on the map). 400 on bad ids, 401/403/404 per the guard.
- **No POST/DELETE.** The log is server-derived from the location-poll; clients never write it. Live
  updates arrive over the `connectionMassLog` realtime task, on which the UI refetches.
- `runtime = 'nodejs'`.
