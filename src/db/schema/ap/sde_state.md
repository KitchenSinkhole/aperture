## sde_state.ts

**Purpose:** Singleton row recording which SDE build the database holds and how the self-refresh job is going.
**File:** `src/db/schema/ap/sde_state.ts`

---

### apSdeState
`pgTable('ap_sde_state', …)` — singleton state row (there is exactly one):
- `id` — `smallint` PK, default `1`, pinned by CHECK `ap_sde_state_singleton_chk` (`id = 1`).
- `current_build` (`currentBuild`, integer, nullable) — the SDE build number this deployment's `universe_*` tables were last fully ingested from.
- `current_release_date` (`currentReleaseDate`, date, nullable) — that build's CCP release date.
- `latest_build` (`latestBuild`, integer, nullable) — the newest build the `sde-refresh` job has observed upstream.
- `latest_release_date` (`latestReleaseDate`, date, nullable) — that build's release date.
- `checked_at` (`checkedAt`, timestamptz, nullable) — when `latest_build` was last checked.
- `behind_since` (`behindSince`, timestamptz, nullable) — when a check first observed `latest_build > current_build`; held across subsequent checks while the gap persists, `null` whenever the two agree. The clock the staleness banner measures `SDE_STALE_GRACE_HOURS` against, since `latest_release_date` carries no publish time and `checked_at` resets on the check that discovers the gap.
- `refreshed_at` (`refreshedAt`, timestamptz, nullable) — when `current_build` last advanced via a successful ingest.
- `failed_at` (`failedAt`, timestamptz, nullable) — when the most recent refresh attempt failed.
- `failure_reason` (`failureReason`, text, nullable) — human-readable cause of the most recent failure.
- `consecutive_failures` (`consecutiveFailures`, integer, `NOT NULL DEFAULT 0`) — resets to 0 on a successful ingest.
- `retained_orphans` (`retainedOrphans`, jsonb, nullable) — `Record<table name, { retained: number; ids: number[] }>`; rows deletion sync would have removed but kept because something still references them, `ids` capped at 50 samples. `null` means no ingest has run since this column was added; `{}` means the last ingest ran deletion sync and retained nothing.
- `uncataloged_wormhole_codes` (`uncatalogedWormholeCodes`, jsonb, nullable) — group-988 wormhole types in the current build with no `universe_wormhole` catalog row.

**Constraints:**
- `ap_sde_state_singleton_chk` — CHECK `(id = 1)`. Forbids a second state row.

**Written by:** `runIngest` (`src/lib/sde/ingest.ts`) upserts `current_build`/`current_release_date`/`refreshed_at`/`retained_orphans`/`uncataloged_wormhole_codes` and clears `behind_since`/`failed_at`/`failure_reason`/`consecutive_failures` on every successful full ingest. The `sde-refresh` job task (`src/lib/jobs/tasks/sdeRefresh.ts`) upserts `latest_build`/`latest_release_date`/`checked_at` on every daily check, sets or clears `behind_since` from that check's comparison, and on any failed attempt writes `failed_at`/`failure_reason`/`consecutive_failures` (incremented). Read by `getSdeStatus` (`src/lib/sde/status.ts`), which backs the `(app)` layout staleness banner, and by the `/setup` detail view.
