## viewers/route.ts

**Purpose:** API route returning the EVE character ids that currently have the map open in a live WebSocket (the viewer roster behind the pilot-roster "online but map not open" icon).
**File:** `src/app/api/map/[mapId]/viewers/route.ts`

---

### `GET /api/map/[mapId]/viewers`
Reads the connected **account** ids from the in-process `mapViewers` roster (`src/lib/realtime/mapViewers.ts`, maintained by the WS server on subscribe/unsubscribe/close) and expands each to every character that account owns (a human with the map open sees all their alts move — coverage is account-level). Returns `{ ok, characterIds }`. **Not** a mutation and **not** the online-pilot roster: location tracking runs server-side regardless of open tabs, so a pilot can be online while their account isn't viewing this map here. `PilotRosterButton` polls this while its popover is open.

**Access:** `map_view` — any viewer may see who else has the map open, except under Blackout: while it restricts the viewer (`getBlackoutStatus` + `isPilotHidden`), only the viewer's own account is expanded, so `characterIds` holds only their own characters.

### Depends On
- `@/db/client` (`db`), `@/db/schema` (`apCharacter`), `drizzle-orm` (`inArray`)
- `@/lib/session` (`getSession`), `@/lib/realtime/mapViewers` (`getMapViewerUserIds`), `../../utils` (`requireMapView`), `@/lib/auth/blackout` (`getBlackoutStatus`, `isPilotHidden`)
