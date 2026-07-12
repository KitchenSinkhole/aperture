## audit/route.ts

**Purpose:** `GET /api/map/[mapId]/audit` — keyset-paginated, filtered commit feed for the in-map audit console. Read-only.
**File:** `src/app/api/map/[mapId]/audit/route.ts`

### GET
Returns `{ ok: true, data: { rows: AuditEventRow[], nextCursor: string | null, actorSummary: ActorSummary | null, actors?: AuditActor[] } }` (see `src/lib/map/audit.ts`). `actorSummary` is populated only on the first page (no `cursor`) of a single-actor drill-down (`characterId` set); it ignores `kinds`/`q` so the header always shows the actor's full per-category breakdown for the window. `actors` (the full actor list backing the filter dropdown) is included only on the first page (no `cursor`), so `MapAuditBrowser` is self-contained inside its dialog.

**Access:** the `audit_view` capability via `requireMapCapability(rawMapId, session, 'audit_view')` (`../../utils`) — a manager holds it implicitly, and a corp title granted it in `ap_map_role_access` holds it too. A viewer with only view access gets 403; an out-of-scope / missing map gets 404 (no existence leak); no session → 401.

**Query params:**
- `cursor` — opaque keyset cursor from a prior `nextCursor`.
- `limit` — page size (default 50, capped 100 in the query layer).
- `characterId` — a numeric character id, or `none` for the automation bucket.
- `kinds` — comma-separated `MapEventKind`s; unknown values are dropped.
- `from` / `to` — ISO timestamps bounding `occurred_at`.
- `q` — best-effort substring search.

Delegates all filtering/paging to `queryAuditEvents`. `runtime = 'nodejs'`.
