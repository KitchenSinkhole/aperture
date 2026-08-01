# Aperture presence (onlineness) for the integrations API

**Goal:** Make `POST /api/integrations/activity-stats` carry whether a member was *present* in Aperture, not only what they edited, and expose raw presence sessions so a consumer can build `character_session` rows.
**References:** `docs/spec/integration-activity-stats.md`, `src/lib/realtime/wsServer.md`, `src/lib/integrations/activityStats.md`, `src/lib/stats/activityShaping.md`, CLAUDE.md (mutation pathways, lifecycle patterns, table prefixes, companion `.md` standing instruction).

---

## Context

`D:\DEV\roster\docs\aperture-activity-endpoint.md` records a gap: `POST /api/integrations/activity-stats` reports **what a member did on the map** and never **whether they were there**. Roster sums the nine edit counters per bucket and drops any bucket summing to zero, so a member who has Aperture open all day but edits nothing is indistinguishable from one who never logged in. Unlike Roster's in-game and Mumble sources, Aperture contributes no `character_session` rows at all.

Aperture cannot fix this from stored data — it has no presence history. `ap_character.last_online` / `last_location_at` are current-value snapshots overwritten by every `location-poll` tick, and the live viewer roster (`src/lib/realtime/mapViewers.ts`) is in-memory, account-keyed and cleared on restart. So this adds a durable presence table, writes to it from the WebSocket socket lifecycle, and exposes it two ways.

**Decisions taken** (see also "Semantics & caveats"):

- **"Online in Aperture" means the app is open in the browser**, i.e. an authenticated WebSocket is connected. It says nothing about EVE-onlineness — the ESI `getCharacterOnline` probe in `location-poll` is deliberately *not* the source.
- **One `ended_at` column, no `last_seen_at`.** `ended_at` is advanced by the existing 30s WS heartbeat and stamped a final time on close. A crashed process leaves it at the last heartbeat, which is the honest bound; "still live" is `ended_at > now() - grace`. No `active` boolean, no dangling-session sweeper job.
- **Sessions are stitched.** A reconnect within a gap window adopts the open row instead of opening a second one, so intervals per character never overlap and presence-seconds need no interval merging.
- **Both contracts.** `activity-stats` buckets gain an `online` block (presence-only buckets stop being dropped) *and* a new `POST /api/integrations/presence-sessions` returns raw intervals for `character_session` parity.
- **Aperture repo only.** The Roster-side ingestion change is a hand-off, described at the end but not planned here.

Presence **accrues forward only** — there is nothing to backfill.

---

## Stage 1 — presence table + write path

**Mode:** Accept edits
**Touches:** `src/db/migrations/0059_character_presence.sql` (+ `.rollback.sql`, journal entry), `src/db/schema/ap/character_presence.ts` (+ `.md`), `src/db/schema/index.ts`, `src/lib/realtime/presenceSessions.ts` (+ `.md`), `src/lib/realtime/wsServer.ts` (+ `.md`), `aperture.config.ts` (+ `.md`)

### Migration

Hand-write the SQL — **do not run `pnpm db:generate`** (the Drizzle snapshot is stale at 0010; the repo has hand-written migrations since 0011). Add the `.rollback.sql` sibling and the journal entry, and apply it before running any DB test.

```sql
CREATE TABLE "ap_character_presence" (
  "id"             bigserial PRIMARY KEY,
  "character_id"   bigint NOT NULL REFERENCES "ap_character"("id") ON DELETE CASCADE,
  "corporation_id" bigint,
  "started_at"     timestamptz NOT NULL DEFAULT now(),
  "ended_at"       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ap_character_presence_interval_ck" CHECK ("ended_at" >= "started_at")
);
CREATE INDEX "ap_character_presence_character_idx"
  ON "ap_character_presence" ("character_id", "started_at" DESC);
CREATE INDEX "ap_character_presence_corp_idx"
  ON "ap_character_presence" ("corporation_id", "started_at" DESC);
```

`corporation_id` is a **snapshot** of `ap_character.corporation_id` taken when the session opens, and it is the tenant boundary the integration reader filters on. Snapshotting (rather than joining current membership at read time) means a corp's token can never see a pilot's presence from before they joined that corp. It is nullable because `ap_character.corporation_id` is nullable; a null-corp row is invisible to every token.

`ON DELETE CASCADE` (not the audit-table `SET NULL`): presence is PII about the character, not map history, and matches `ap_map_character_tracking`.

### Config constants (`aperture.config.ts`)

| Constant | Value | Purpose |
|---|---|---|
| `PRESENCE_SESSION_GAP_MS` | `300_000` | Reconnect within this window adopts the open session |
| `PRESENCE_LIVE_GRACE_MS` | `60_000` | `ended_at` newer than this ⇒ session is live (2× `WS_HEARTBEAT_MS`) |
| `PRESENCE_RETENTION_DAYS` | `400` | Prune horizon (Stage 4) |

### `src/lib/realtime/presenceSessions.ts`

**Must not `import 'server-only'`** — `wsServer.ts` is loaded by `server.ts` outside Next's bundler, where the shim does not resolve. Follow the sibling modules (`mapViewers.ts`, `wsConnections.ts`) which say so explicitly.

Two exports:

- `openPresenceSession(characterId: bigint): Promise<bigint | null>` — one statement, a CTE that first tries the adopt path and falls back to insert:

  ```sql
  WITH adopted AS (
    UPDATE ap_character_presence SET ended_at = now()
    WHERE id = (
      SELECT id FROM ap_character_presence
      WHERE character_id = $1 AND ended_at > now() - $2::interval
      ORDER BY started_at DESC LIMIT 1
    )
    RETURNING id
  ), inserted AS (
    INSERT INTO ap_character_presence (character_id, corporation_id)
    SELECT $1, c.corporation_id FROM ap_character c
    WHERE c.id = $1 AND NOT EXISTS (SELECT 1 FROM adopted)
    RETURNING id
  )
  SELECT id FROM adopted UNION ALL SELECT id FROM inserted;
  ```

  Returns `null` if the character row is gone (never throw into the socket handler).

- `touchPresenceSessions(ids: bigint[]): Promise<void>` — one `UPDATE … SET ended_at = now() WHERE id = ANY($1)`. This is also the **close** path: closing is just the final touch, so there is no third function.

### `wsServer.ts` hooks

- `ClientState` gains `presenceSessionId: bigint | null`.
- On `connection` (beside `incWsConnection()`): fire-and-forget `openPresenceSession(BigInt(session.characterId))` and assign the result to `state.presenceSessionId`. Never block or reject the socket on a presence write failure — log and continue.
- In the existing `heartbeat` `setInterval`: after the ping/`healthCheck` loop, collect the non-null `presenceSessionId`s of still-live clients and issue **one** batched `touchPresenceSessions(ids)`.
- On `close`: `void touchPresenceSessions([state.presenceSessionId])` when set.

Presence is per **character** (`session.characterId`), unlike `mapViewers`, which is per account — Roster keys on character ids, and the WS session already holds exactly one active character.

**Done when:** `pnpm lint && pnpm typecheck && pnpm build` are green and connecting a real socket in dev inserts one `ap_character_presence` row whose `ended_at` advances every 30s.

---

## Stage 2 — integration reader

**Mode:** Accept edits
**Touches:** `src/lib/integrations/presence.ts` (+ `.md`), `src/types/index.ts`

Two exports, both scoped by `corporation_id = <token corp>` — this is the same load-bearing tenant boundary as `loadIntegrationActivityStats`; treat a bug here as highest severity.

- `loadPresenceSessions({ corporationId, characterIds, from?, to? })` — every session **overlapping** `[from, to]` (not merely starting in it), returned per character in request order, quiet characters as `sessions: []`. Each session is `{ startedAt, endedAt, live }` where `live = endedAt > now() - PRESENCE_LIVE_GRACE_MS`. Also returns `coverage` (min `started_at` / max `ended_at` in corp scope).
- `loadPresenceBuckets({ corporationId, characterIds, from?, to?, granularity })` — the same rows clipped per bucket. Reuse `bucketStart` and `toISODate` from `src/lib/stats/activityShaping.ts` (do not re-derive Monday/ISO-week math), splitting any session that spans a boundary with `GREATEST(started_at, bucketStart)` / `LEAST(ended_at, bucketEnd)`. Returns per character a `Map<bucketStartISO, { seconds, sessions, lastSeenAt }>`:
  - `seconds` — clipped presence seconds in that bucket,
  - `sessions` — number of sessions touching the bucket,
  - `lastSeenAt` — max clipped `ended_at`, a **real instant** (this is what replaces Roster's synthetic UTC-midnight `lastSeenAt`).

Add `IntegrationPresenceSession`, `IntegrationCharacterPresence`, `IntegrationPresenceResponse` and `IntegrationOnlineSummary` to `src/types/index.ts` and re-export, matching how `activityStats.ts`'s types are handled today.

**Done when:** typecheck is green; no route wired yet.

---

## Stage 3 — endpoints

**Mode:** Accept edits
**Touches:** `src/lib/integrations/activityStats.ts` (+ `.md`), `src/app/api/integrations/activity-stats/route.md`, `src/app/api/integrations/presence-sessions/route.ts` (+ `.md`), `aperture.config.ts`

### `activity-stats` — additive change

`loadIntegrationActivityStats` calls `loadPresenceBuckets` with the same window/granularity and merges:

- A bucket is emitted when it has **any activity or any presence**. This is the requirement from the Roster note: a presence-only bucket must no longer be dropped.
- Every emitted bucket carries `online: { seconds, sessions, lastSeenAt }`, zeroed (`lastSeenAt: null`) when there was no presence.
- `coverage` widens to span both the rollup days and the presence days.

This is backwards compatible: Roster parses with a non-strict `z.object`, so the extra key is stripped until Roster opts in. Existing counters are untouched.

### `POST /api/integrations/presence-sessions` — new route

Copy the shape of `src/app/api/integrations/activity-stats/route.ts` exactly: `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `withApiMetrics('/api/integrations/presence-sessions', …)`, `env.INTEGRATIONS_ENABLED` → 404, `resolveIntegrationToken` → 401 with `WWW-Authenticate: Bearer`, zod body → 400, same `INTEGRATION_MAX_CHARACTER_IDS` cap.

```jsonc
// request
{ "characterIds": [90000001], "from": "2026-05-01", "to": "2026-07-31" }

// response
{ "generatedAt": "2026-08-01T12:00:00.000Z",
  "coverage": { "earliest": "2026-06-15", "latest": "2026-07-31" },
  "characters": [ { "characterId": 90000001, "sessions": [
      { "startedAt": "2026-07-27T18:02:00.000Z",
        "endedAt":   "2026-07-27T21:44:11.000Z",
        "live": false } ] } ] }
```

**Deliberate difference from `activity-stats`:** the window is bounded. Sessions are far more numerous than daily rollup rows, so an omitted `from` defaults to `to − INTEGRATION_PRESENCE_DEFAULT_WINDOW_DAYS` (90) rather than "everything", and a window wider than `INTEGRATION_PRESENCE_MAX_WINDOW_DAYS` (366) is a `400` telling the caller to page. Add both constants to `aperture.config.ts` (+ `.md`).

Roster maps the response onto `character_session` as `logonAt = startedAt`, `lastConfirmedAt = endedAt`, `logoffAt = live ? null : endedAt`.

**Done when:** `pnpm lint && pnpm typecheck && pnpm build` are green and both endpoints answer correctly against a minted dev token (`pnpm integrations:mint-token mint`).

---

## Stage 4 — retention

**Mode:** Accept edits
**Touches:** `src/lib/jobs/tasks/characterCleanup.ts` (+ `.md`)

Add a fourth phase to the existing `character-cleanup` cron: one indexed `DELETE FROM ap_character_presence WHERE ended_at < now() - PRESENCE_RETENTION_DAYS`, and a `presencePruned` count in the `ap_job_run.notes` payload. A separate job is not warranted — this is a mostly-no-op delete on a 5-minute tick.

**Done when:** the job runs clean and `notes.presencePruned` appears in `pnpm jobs:status`.

---

## Stage 5 — tests

**Mode:** Accept edits
**Touches:** `tests/integration/integration-presence.test.ts` (new), `tests/integration/integration-activity-stats.test.ts`, `tests/integration/realtime-transport.test.ts`

Follow the existing `integration-activity-stats.test.ts` pattern: `RUN_DB_TESTS=1`, real Postgres, `migrate()` + `cleanup()` in `beforeAll`, fixed corp/character ids in a private range.

New `integration-presence.test.ts`:
- **Tenant boundary** — corp B's presence rows never surface for a corp A token, even when corp B's character id is in `characterIds`. Mirror the existing outsider case.
- **Bucket clipping** — a session spanning UTC midnight contributes to both days' `seconds`, summing to its true duration.
- **`live` flag** — a row with fresh `ended_at` is `live: true`; a stale one is `false`.
- **Overlap semantics** — a session that starts before `from` and ends inside the window is returned, clipped.
- **Window bounds** — omitted `from` defaults to 90 days; an over-wide window is a 400.

Extend `integration-activity-stats.test.ts`:
- A character with **presence but zero edits** produces a bucket with zeroed counters and non-zero `online.seconds` (the regression this whole change exists to fix).
- `coverage` widens to include presence-only days.

Extend `realtime-transport.test.ts`: connecting a real socket opens exactly one `ap_character_presence` row; a reconnect inside `PRESENCE_SESSION_GAP_MS` adopts it rather than opening a second; closing advances `ended_at`.

Run these in isolation (`pnpm test integration-presence`) — the full `RUN_DB_TESTS` suite is parallel-flaky and triage belongs on the isolated file.

**Done when:** `docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test integration-presence` passes, plus the two extended files, and `pnpm lint && pnpm typecheck && pnpm build`.

---

## Stage 6 — contract docs

**Mode:** Accept edits
**Touches:** `docs/spec/integration-activity-stats.md`, `CHANGELOG.md`

The Roster note requires the two contracts move in lockstep. Update the spec:
- §1 namespace list gains `POST /api/integrations/presence-sessions`.
- §4 response gains the `online` block and the rule that a bucket is emitted on activity **or** presence.
- A new section specifies presence: the source (WS socket lifetime, not ESI onlineness), the stitching rule, `live` semantics, the bounded window, the `corporation_id`-snapshot tenant boundary, retention, and that presence accrues forward only with no backfill.
- Tick the §8 checklist boxes that are already satisfied.

---

## Semantics & caveats to state in the spec

- **A backgrounded tab counts.** The socket survives a minimised window, so "Aperture open all day at work" scores a full day. This is inherent to any presence metric (Mumble has the same property) and is why the endpoint reports `seconds` *and* `sessions` — a consumer wanting engagement rather than uptime can weigh session count.
- **Stitching over-counts by at most `PRESENCE_SESSION_GAP_MS`** per gap: a genuine 3-minute absence inside the 5-minute window is recorded as present. The trade is deliberate — it stops a WiFi blip or SharedWorker restart from shredding one evening into a dozen sessions.
- **Presence is browser presence, not EVE presence.** A pilot flying with Aperture closed is absent here, and their location tracking still runs server-side regardless.
- **No backfill.** Coverage starts at deploy; a consumer should treat pre-deploy buckets as unknown, not as zero.

---

## Verification

1. `docker compose up -d`, export `DATABASE_URL` from `.env` manually, `pnpm db:migrate`.
2. `pnpm dev` (this is the only thing that catches a stray `server-only` import in a `server.ts`-side module — lint, typecheck and build all miss it). Open a map, then confirm one `ap_character_presence` row exists for the session character and its `ended_at` advances every 30s. Close the tab; confirm `ended_at` stops. Reopen within 5 minutes; confirm the same row is adopted, not a second one.
3. `pnpm integrations:mint-token mint` for your corp, then `INTEGRATIONS_ENABLED=true` and curl both endpoints with the token; confirm 404 with the flag off, 401 on a bad token.
4. `RUN_DB_TESTS=1 pnpm test integration-presence`, then the two extended files, each in isolation.
5. `pnpm lint && pnpm typecheck && pnpm build` (retry a build that fails with the intermittent "inferred workspace root" error — that one is not a code fault).

---

## Hand-off to Roster (not in scope here)

Once Aperture ships, Roster needs, in `D:\DEV\roster`:
- `src/lib/sources/aperture.ts` — widen the bucket zod schema with the optional `online` block, and add a `fetchAperturePresenceSessions` client.
- `src/lib/snapshots/apertureActivity.ts` — stop dropping a bucket whose nine counters sum to zero when `online.seconds > 0`, and use `online.lastSeenAt` as the real `lastSeenAt` instead of synthetic UTC midnight.
- New ingestion writing `character_session` rows with `source: 'aperture'` (`logonAt`/`logoffAt`/`lastConfirmedAt` per the mapping above), reusing the natural-key upsert so the overlap window stays idempotent.
