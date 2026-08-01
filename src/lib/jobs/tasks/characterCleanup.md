## characterCleanup.ts

**Purpose:** Cron-driven character maintenance. Handles four responsibilities: timed-kick expiry, periodic authz resync against ESI, a per-tick affiliation sweep that revokes access when a pilot leaves the owning corp/alliance, and presence retention pruning.
**File:** `src/lib/jobs/tasks/characterCleanup.ts`

---

### characterCleanup: JobModule
- `name`: `'character-cleanup'`
- `cron`: `apertureConfig.CHARACTER_CLEANUP_CRON` (default `*/5 * * * *` — 5-minute cadence keeps post-expiry login latency below the 5-minute minimum kick duration).
- `run`: `withInstrumentation('character-cleanup', cleanup)` — `ap_job_run` carries per-tick metrics.

### Phases

**1. Kick expiry.** A single bulk UPDATE flips `status='kicked' → 'active'` for every row where `status_expires_at <= now()`, clearing `status_expires_at` and `status_reason`. Banned rows (`status='banned'`, `status_expires_at IS NULL`) are never touched. No `pg_notify` — the realtime bus doesn't subscribe to `ap_character`; sessions pick up the new status at next refresh.

**2. Periodic authz resync.** Pulls up to `CHARACTER_AUTHZ_RESYNC_BATCH_SIZE` (25) characters where `status='active'`, `esi_refresh_token IS NOT NULL`, and `authz_synced_at IS NULL OR <= now() - CHARACTER_AUTHZ_RESYNC_STALE_AFTER_MS` (6h). Calls `syncCharacterAuthz(id)` for each. ESI failures are absorbed row-by-row (the helper returns `{ applied: false, skipped }` without touching the DB) so a noisy CCP outage doesn't poison the batch. Rows ordered by `authz_synced_at ASC NULLS FIRST` so the stalest data drains first.

**3. Affiliation sweep + access revocation/grant.** Selects every `status='active'` character with a refresh token and resolves corp/alliance in one bulk `fetchAffiliations` POST (`getCharacterAffiliation`, ~1h cache, chunked to 1000). A whole-batch ESI failure (`EsiBreakerOpenError`/`EsiDowntimeError`/`EsiHttpError`) skips the phase for this tick. For each character whose corp or alliance differs from the cached `ap_character` value, it runs a full `syncCharacterAuthz(id)` (refreshes corp/alliance + director/titles/executor/`authz_level`), then `pruneTrackingForLostAccess(id)` (deleting tracking rows on maps the pilot can no longer view + `characterLogout` so rosters drop them), then `seedTrackingForGainedAccess(id)` (`src/lib/jobs/tracking.ts`) — the mirror: re-adding tracking on already-seeded maps the pilot can now view (corp re-join / move into a corp/alliance with map access). Ids ESI omits leave the cached value untouched. This revokes/grants corp/alliance map access on departure/arrival, bounded by ESI's ~1h cache + the 5-min tick. (Note: a re-join immediately followed by a fresh login is handled at login — `syncCharacterAuthz` there freshens the cache, so this sweep sees no diff; `src/lib/auth.ts` calls `seedTrackingForGainedAccess` in the sign-in callback to cover it.)

**4. Presence retention.** One indexed `DELETE FROM ap_character_presence WHERE ended_at < now() - PRESENCE_RETENTION_DAYS` (400 days). A separate job isn't warranted — this is a mostly-no-op delete on the existing 5-minute tick.

> **Execution order:** kick-expiry → **affiliation sweep** → authz resync → presence retention. The sweep runs *before* the resync deliberately: the resync's `syncCharacterAuthz` updates `corporation_id` without pruning tracking, so if it ran first the sweep would see no diff and never revoke. Running the sweep first detects the change against the still-stale stored value and stamps `authz_synced_at`, so the resync skips that character this tick.

### Notes payload (in `ap_job_run.notes`)
```ts
{
  kicksCleared: number,
  authzResynced: number,
  authzSkipped: number,
  authzScanned: number,
  affiliationScanned: number,
  affiliationChanged: number,
  trackingPruned: number,
  trackingSeeded: number,
  presencePruned: number,
}
```

### Depends On
- `@/db/client` (`db`), `@/db/schema` (`apCharacter`, `apCharacterPresence`).
- `@/lib/auth/syncCharacterAuthz` — the per-character reconciliation helper.
- `@/lib/esi/affiliation` (`fetchAffiliations`), `@/lib/esi/client` (ESI error types).
- `../tracking` (`pruneTrackingForLostAccess`, `seedTrackingForGainedAccess`) — the revocation + grant steps.
- `aperture.config` — `CHARACTER_CLEANUP_CRON`, `CHARACTER_AUTHZ_RESYNC_STALE_AFTER_MS`, `CHARACTER_AUTHZ_RESYNC_BATCH_SIZE`, `PRESENCE_RETENTION_DAYS`.

### Invariants
- Bans are permanent. The job never touches `status='banned'` rows.
- Each character is touched at most once per tick (LIMIT batch).
- A single bad character cannot abort the tick — `try/catch` per row.
