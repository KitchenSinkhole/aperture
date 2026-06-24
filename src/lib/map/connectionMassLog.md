## connectionMassLog.ts

**Purpose:** Server-side writer for the per-jump connection mass-log — insert + broadcast.
**File:** `src/lib/map/connectionMassLog.ts`

Server-only by usage (no `import 'server-only'` — it's reached by the location-poll job chain that the
custom `server.ts` loads via tsx outside Next's bundler, where the shim doesn't resolve; same precedent
as `locationCommit.ts` / `bus.ts`). Called from the location-poll's wormhole-jump fold (`src/lib/jobs/locationCommit.ts`).
**Bypasses `ap_map_event`** by design: the mass-log is a server-observed transient with its own durable
table + audit, not part of `MapViewData`. Fans out via a direct `pg_notify` on `map:<id>` under the
`connectionMassLog` task (see `src/lib/realtime/bus.ts`, `src/lib/realtime/protocol.ts`).

---

### logConnectionJump(args: LogConnectionJumpArgs): Promise<void>
Inserts one `ap_map_connection_log` row, computes the connection's running cumulative mass, and
broadcasts a `connectionMassLog` envelope to the map channel.

**Parameters (`LogConnectionJumpArgs`):**
- `mapId` — the map whose channel receives the broadcast.
- `connectionId` — the connection that was traversed.
- `characterId` — who jumped (nullable).
- `shipTypeId` — the ship (nullable).
- `mass` — kg for this jump. **When `null` the call is a no-op** (warns): an unresolved mass would
  corrupt the cumulative sum, and the column is NOT NULL.

**Side effects:** one INSERT, one `SUM` read, one `pg_notify`. Cumulative stays within JS safe-int
range (a hole's max stable mass is ~3e9 kg).

---

### listConnectionMassLog({ mapId, connectionId }): Promise<ConnectionMassLogEntry[]>
The connection's log for display — **newest jump first**, joined to the acting character (name) + ship
type (name). `cumulativeMass` on each entry is the chronological running total up to and including
that jump, computed via a SQL window function (`SUM … OVER (ORDER BY jumped_at ASC, id ASC)`) so it
remains correct regardless of the DESC outer sort. **Scoped to `mapId`** (inner-joins `ap_map_connection`)
so a connection id from another map can't be read through this map's route; returns `[]` when the
connection isn't on the map. Backs `GET /api/map/[mapId]/connections/[connId]/mass-log`.

