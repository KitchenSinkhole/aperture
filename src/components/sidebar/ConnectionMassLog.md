## ConnectionMassLog

**Purpose:** Read-only per-jump mass-log for the selected wormhole connection.
**File:** `src/components/sidebar/ConnectionMassLog.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| mapId | string | yes | The open map's id (`viewData.map.id`); scopes the GET. |
| connection | MapConnectionEdge | yes | The selected connection; `id` drives the fetch, `jumpMassClass` the ceiling hint. |

### Renders
A bordered block under the connection inspector's expiry hint: a "Mass log" header (with the
`jumpMassClass` max-per-jump hint), one row per logged jump (pilot · ship · time-ago · mass in kt),
and a cumulative total. Loading / failed / empty states are inline text.

### Behaviour & Interactions
- **Read-only.** The log is server-derived from the location-poll; there is no add/delete control.
- Lazy `GET`s `/api/map/{mapId}/connections/{id}/mass-log` on mount and whenever `connection.id`
  changes (the parent also remounts via `key={connection.id}`).
- Registers a `useRealtimeEvents` listener; on a `connectionMassLog` envelope whose `connectionId`
  matches the open connection, it **refetches** the list. A monotonic `reqSeq` ref makes the latest
  refetch win, so a burst of jump events (each delivered exactly once, no `lastEvent` coalescing)
  can't land an older response after a newer one.
- Mass is shown in kilotonnes (1 kt = 1e6 kg), matching `JumpInfoDialog`.
- Entries arrive newest-first from the server; `cumulative` reads `entries[0].cumulativeMass` (the most recent entry carries the highest running total).

### Limitation
Exact "% to next mass status" needs the WH type's total stable mass, which connections don't store —
so this shows the cumulative absolute + the `jumpMassClass` ceiling only.

### Emits / Calls
- `fetchConnectionMassLog({ mapId, connectionId })` — `src/lib/map/client.ts`.
- `useRealtimeEvents()` — for the `connectionMassLog` refetch trigger.

### Depends On
- `connectionMassLogLoadSchema`, `Envelope` (`src/lib/realtime/protocol.ts`) — validates the realtime load.
- `formatAgoFromMs` (`src/lib/map/relativeTime.ts`).
