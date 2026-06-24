## audit.ts

**Purpose:** Read layer for the in-map audit console — turns the append-only `ap_map_event` log into a filtered, keyset-paginated, human-rendered commit feed for one map.
**File:** `src/lib/map/audit.ts`

Reuses `describeMapEvent` (`src/lib/webhooks/formatters.ts`) so a commit reads identically in the audit table and the Discord history webhook, and resolves the naming context for a whole *page* of events in a fixed number of batched queries (vs. the dispatcher's per-event joins). `import 'server-only'` — used only by the API route, never the job runner. Access to the feed is gated by `canManageMap` in `GET /api/map/[mapId]/audit`; this module assumes the caller is already authorised and does no scoping of its own.

**Actor = account main.** Every commit is attributed to the acting character's account *main* (`ap_character.user_id → ap_user.main_character_id`, via the `auditMainChar` self-alias), falling back to the acting character when no main is recorded. So once an alt is re-homed onto a main's account (issue #116), its prior commits reattribute to the main at query time — matching the stats rollup, with nothing to migrate. The shared SQL `rolledActorId = coalesce(main_character_id, character_id)` backs the feed display, the actor filter, the dropdown grouping, and the per-actor summary alike, so all four agree.

---

### listAuditActors(mapId): Promise<AuditActor[]>
Distinct **account** actors who have committed to the map (acting characters grouped by their `rolledActorId` main), each named by the main character and carrying the summed event count. Includes the `characterId: null` automation bucket (named "System / automation"). Sorted by event count desc. The returned `characterId` is the account main's id (an alt never appears as its own dropdown entry).

---

### queryAuditEvents(params: AuditQueryParams): Promise<AuditPage>
Keyset-paginated feed, newest first. Pages back through time via an opaque base64url `cursor` encoding the last `(occurred_at, id)`, riding the `(map_id, occurred_at DESC)` index. Each row's `characterId`/`characterName` are the acting character's **account main** (rolled up — see above). Filters: `characterId` (a bigint **account-main** id, `'none'` for automation, or omit for all — matches every commit by any character in that account via `rolledActorId`), `kinds`, `from`/`to` (`occurred_at` window — also prunes partitions), and `q` (best-effort substring `ILIKE` over acting + main actor name, kind, and `payload ->> sigId|name|alias|tag|title`). Position-only `system.updated` **and** `note.updated` drags are excluded at the DB (`jsonb_exists`/`jsonb_exists_any`) so paging stays dense — the note exclusion checks `[content,severity,locked]` (not `title`, which always rides a note update), so a pure note drag is dropped while a title rename survives.

After fetching `limit + 1` rows it batch-resolves every referenced system name in **one** query, then renders each row's `summary` with `describeMapEvent` (falling back to local phrasing for the admin-only `map.restore` / `map.purge`). Every system reference — including the audit descriptors embedded in `connection.delete`/`connection.update` (endpoint ids), `signature.delete`/`signature.update` (`mapSystemId`), and `signature.create`/`signature.update` (`leadsToMapSystemId`, the link destination) — is an `ap_map_system` id resolved against the persistent (soft-deleted) `ap_map_system` rows, so hard-deleted connections / signatures still render their endpoints / system instead of "a system". No live join to `ap_map_connection` is needed (its row may be gone). `describeMapEvent` returns the **action with no actor** (the table has its own Actor column); `capitalize()` sentence-cases it and adds a period so the summary reads standalone (`"Updated signature \`AUQ\` in **J160941** (type → \`B274\`)."`). `*.update` summaries enumerate every changed field, so the reader sees what a commit altered, not just that it changed. `limit` defaults to 50, capped at 100. Returns `{ rows, nextCursor }`; `nextCursor` is `null` when the last page is reached.

---

### auditActorSummary(mapId, characterId, from?, to?): Promise<ActorSummary>
Cheap `COUNT(*) GROUP BY kind` aggregate for the drill-down header: per-category counts, total, and a highlighted destructive count (`system.removed`, `connection.delete`, `signature.delete`, `note.deleted`, `map.delete`, `map.purge`). `characterId` is a bigint **account-main** id (aggregates every commit by any character in that account via `rolledActorId`) or `'none'`. Applies the same position-only exclusion + date window as the feed so the numbers match.

---

### Types
- `AuditEventCategory` — `'system' | 'connection' | 'signature' | 'note' | 'map'` (derived from the kind prefix).
- `AuditEventRow` — `{ id, occurredAt, kind, category, characterId, characterName, summary, destructive }` (ids as strings).
- `AuditActor` — `{ characterId, name, eventCount }`; `characterId` is the account main's id (commits roll up to the main), `null` = automation.
- `ActorSummary` — `{ total, destructive, byCategory }`.
- `AuditQueryParams` — `{ mapId, characterId?, kinds?, from?, to?, q?, cursor?, limit? }`.
- `AuditPage` — `{ rows, nextCursor }`.
