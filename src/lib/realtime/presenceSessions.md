## presenceSessions.ts

**Purpose:** Write path for `ap_character_presence` — durable, WebSocket-lifetime-derived presence sessions (docs/plans/integration-presence.md).
**File:** `src/lib/realtime/presenceSessions.ts`

---

### openPresenceSession(characterId: bigint): Promise<bigint | null>
Opens or adopts a presence session for `characterId` in one statement: a CTE that first tries to adopt an existing row whose `ended_at` is within `PRESENCE_SESSION_GAP_MS` of now (bumping its `ended_at` to now), falling back to an insert (snapshotting `ap_character.corporation_id`) only when nothing was adopted. Returns the session's `id`.

Never throws: returns `null` if the character row no longer exists or on any write failure (logged, not propagated) — a presence-write fault must not affect the socket it's attached to.

---

### touchPresenceSessions(ids: bigint[]): Promise<void>
Advances `ended_at = now()` on every listed session id in one `UPDATE`. No-op on an empty list. This is also the **close** path — closing a socket is just the final touch, so there is no separate close function. Never throws.

### Depends On
- `@/db/client` (`db.execute`), `drizzle-orm` (`sql`), `aperture.config` (`PRESENCE_SESSION_GAP_MS`), `@/lib/log/logger` (`getLogger('server')`).

### Notes
- No `import 'server-only'`: reached from `wsServer.ts`, loaded by the custom `server.ts` outside Next's bundler where the shim doesn't resolve.
