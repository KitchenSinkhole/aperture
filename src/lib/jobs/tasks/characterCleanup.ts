import { and, asc, eq, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { apertureConfig } from '../../../../aperture.config';
import { db } from '@/db/client';
import { apCharacter, apCharacterPresence } from '@/db/schema';
import { syncCharacterAuthz } from '@/lib/auth/syncCharacterAuthz';
import { fetchAffiliations } from '@/lib/esi/affiliation';
import {
  EsiBreakerOpenError,
  EsiDowntimeError,
  EsiHttpError,
} from '@/lib/esi/client';
import { pruneTrackingForLostAccess, seedTrackingForGainedAccess } from '../tracking';
import { withInstrumentation } from '../withInstrumentation';
import type { JobModule } from '../registry';

/**
 * Cron-driven character maintenance. Single cron task with several
 * responsibilities:
 *
 *   1. **Kick expiry.** Flip `status` from `'kicked'` back to `'active'` and
 *      `NULL` out `status_expires_at` / `status_reason` for every row where
 *      `status='kicked' AND status_expires_at <= now()`. Bans
 *      (`status='banned'`, `status_expires_at IS NULL`) are permanent and
 *      untouched.
 *
 *   2. **Periodic authz resync.** Re-run `syncCharacterAuthz` for every
 *      active character whose `authz_synced_at` is older than
 *      `CHARACTER_AUTHZ_RESYNC_STALE_AFTER_MS` (or NULL). Keeps the
 *      Director → admin promotion non-stale for characters who don't log
 *      in often. Bounded by `CHARACTER_AUTHZ_RESYNC_BATCH_SIZE` per tick;
 *      the next tick picks up the rest. ESI failures are tolerated row-by-row
 *      — `syncCharacterAuthz` returns `{ applied: false, skipped: ... }`
 *      without touching the DB so the cron keeps going.
 *
 *   3. **Affiliation sweep + access revocation.** Resolve every active,
 *      token-holding character's corp/alliance in one bulk
 *      `getCharacterAffiliation` POST (~1h cache, chunked). For each character
 *      whose corp/alliance changed vs. the cached `ap_character` value, run a
 *      full `syncCharacterAuthz` (corp/alliance + director/titles/executor/
 *      authz), then `pruneTrackingForLostAccess` — dropping their tracking
 *      on maps they can no longer view and broadcasting `characterLogout` — then
 *      `seedTrackingForGainedAccess`, the mirror that re-tracks them on already-
 *      seeded maps they can now view (corp re-join / move into a corp with map
 *      access). This is what makes a pilot who left the owning corp lose
 *      corp/alliance maps and disappear from the roster (and a re-joining one
 *      come back tracked), bounded by ESI's ~1h cache + the cron tick. A re-join
 *      immediately followed by a fresh login is instead covered at login —
 *      `auth.ts` calls `seedTrackingForGainedAccess` there, because the login's
 *      own `syncCharacterAuthz` freshens the cache so this sweep sees no diff.
 *
 *   4. **Presence retention.** One indexed `DELETE FROM ap_character_presence
 *      WHERE ended_at < now() - PRESENCE_RETENTION_DAYS`. A mostly-no-op
 *      delete on a 5-minute tick, not worth a dedicated job.
 *
 * Phases 1–2 fan out no `pg_notify` (only `ap_character` is mutated; tabs see
 * the demotion at next session refresh). Phase 3 *does* broadcast
 * `characterLogout` for revoked pilots so live maps update immediately.
 * Phase 4 mutates `ap_character_presence` only.
 */

const NAME = 'character-cleanup';

interface CleanupNotes {
  kicksCleared: number;
  authzResynced: number;
  authzSkipped: number;
  authzScanned: number;
  affiliationScanned: number;
  affiliationChanged: number;
  trackingPruned: number;
  trackingSeeded: number;
  presencePruned: number;
}

async function clearKickExpiries(): Promise<number> {
  const result = await db
    .update(apCharacter)
    .set({
      status: 'active',
      statusExpiresAt: null,
      statusReason: null,
      statusChangedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(apCharacter.status, 'kicked'),
        isNotNull(apCharacter.statusExpiresAt),
        lte(apCharacter.statusExpiresAt, sql`now()`),
      ),
    )
    .returning({ id: apCharacter.id });
  return result.length;
}

async function resyncStaleAuthz(): Promise<{ scanned: number; applied: number; skipped: number }> {
  const cutoff = new Date(
    Date.now() - apertureConfig.CHARACTER_AUTHZ_RESYNC_STALE_AFTER_MS,
  );

  const candidates = await db
    .select({ id: apCharacter.id })
    .from(apCharacter)
    .where(
      and(
        eq(apCharacter.status, 'active'),
        isNotNull(apCharacter.esiRefreshToken),
        or(isNull(apCharacter.authzSyncedAt), lte(apCharacter.authzSyncedAt, cutoff)),
      ),
    )
    .orderBy(asc(apCharacter.authzSyncedAt))
    .limit(apertureConfig.CHARACTER_AUTHZ_RESYNC_BATCH_SIZE);

  let applied = 0;
  let skipped = 0;
  for (const row of candidates) {
    try {
      const result = await syncCharacterAuthz(row.id);
      if (result.applied) applied += 1;
      else skipped += 1;
    } catch {
      // Unexpected error from a single character must not abort the batch.
      // `syncCharacterAuthz` returns `{ applied: false }` on ESI failures;
      // anything reaching this catch is either a DB error or programmer bug.
      skipped += 1;
    }
  }

  return { scanned: candidates.length, applied, skipped };
}

/**
 * Bulk-resolve active characters' corp/alliance via the affiliation endpoint and
 * revoke access for any whose membership changed. Detection is near-free (one
 * cached POST); the heavy per-character recompute (`syncCharacterAuthz` +
 * tracking prune) only runs for pilots who actually moved corp/alliance.
 *
 * A whole-batch ESI failure (breaker open / downtime / HTTP) skips this tick
 * cleanly — the next tick retries. A per-character id ESI omits from the
 * response leaves the cached value untouched (no stomp to a wrong corp).
 */
async function syncAffiliationsAndRevoke(): Promise<{
  scanned: number;
  changed: number;
  pruned: number;
  seeded: number;
}> {
  const characters = await db
    .select({
      id: apCharacter.id,
      corporationId: apCharacter.corporationId,
      allianceId: apCharacter.allianceId,
    })
    .from(apCharacter)
    .where(and(eq(apCharacter.status, 'active'), isNotNull(apCharacter.esiRefreshToken)));
  if (characters.length === 0) return { scanned: 0, changed: 0, pruned: 0, seeded: 0 };

  let affiliations;
  try {
    affiliations = await fetchAffiliations(characters.map((c) => c.id));
  } catch (err) {
    if (
      err instanceof EsiBreakerOpenError ||
      err instanceof EsiDowntimeError ||
      err instanceof EsiHttpError
    ) {
      return { scanned: characters.length, changed: 0, pruned: 0, seeded: 0 };
    }
    throw err;
  }

  let changed = 0;
  let pruned = 0;
  let seeded = 0;
  for (const c of characters) {
    const current = affiliations.get(c.id);
    if (!current) continue; // ESI omitted this id — leave the cached value as-is.
    const corpChanged = c.corporationId === null || c.corporationId !== current.corporationId;
    const allianceChanged = (c.allianceId ?? null) !== (current.allianceId ?? null);
    if (!corpChanged && !allianceChanged) continue;

    changed += 1;
    // Recompute the full derived-authority state (corp/alliance + director,
    // titles, alliance executor, authz_level) before re-checking view access —
    // a corp change invalidates all of them — then prune now-inaccessible maps.
    await syncCharacterAuthz(c.id);
    const { prunedMapIds } = await pruneTrackingForLostAccess(c.id);
    pruned += prunedMapIds.length;
    // Mirror of the prune: a corp re-join (or move into a new corp/alliance
    // with map access) re-tracks the pilot on already-seeded maps without
    // needing a fresh login.
    const { seededMapIds } = await seedTrackingForGainedAccess(c.id);
    seeded += seededMapIds.length;
  }
  return { scanned: characters.length, changed, pruned, seeded };
}

async function prunePresence(): Promise<number> {
  const cutoff = new Date(Date.now() - apertureConfig.PRESENCE_RETENTION_DAYS * 86_400_000);
  const result = await db
    .delete(apCharacterPresence)
    .where(lt(apCharacterPresence.endedAt, cutoff))
    .returning({ id: apCharacterPresence.id });
  return result.length;
}

async function cleanup(): Promise<CleanupNotes> {
  const kicksCleared = await clearKickExpiries();
  // The affiliation sweep must run *before* the stale-authz resync: the resync
  // calls `syncCharacterAuthz`, which updates `corporation_id` without pruning
  // tracking. If it ran first it would silently overwrite the stored corp, so
  // the sweep would then see no diff and never revoke. Running the sweep first
  // detects the change against the still-stale stored value, prunes, and stamps
  // `authz_synced_at` so the resync skips the same character this tick.
  const affiliation = await syncAffiliationsAndRevoke();
  const resync = await resyncStaleAuthz();
  const presencePruned = await prunePresence();
  return {
    kicksCleared,
    authzResynced: resync.applied,
    authzSkipped: resync.skipped,
    authzScanned: resync.scanned,
    affiliationScanned: affiliation.scanned,
    affiliationChanged: affiliation.changed,
    trackingPruned: affiliation.pruned,
    trackingSeeded: affiliation.seeded,
    presencePruned,
  };
}

export const characterCleanup: JobModule = {
  name: NAME,
  cron: apertureConfig.CHARACTER_CLEANUP_CRON,
  run: withInstrumentation(NAME, cleanup),
};
