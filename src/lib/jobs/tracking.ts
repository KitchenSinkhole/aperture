import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { apCharacter, apMap, apMapCharacterTracking, apMapTrackingSeed } from '@/db/schema';
import { canViewMap } from '@/lib/auth/rights';
import { getLogger } from '@/lib/log/logger';
import { broadcastCharacterLogout } from '@/lib/realtime/characterLogout';
import { locationPollJobKey } from './tasks/locationPoll';

const jobLog = getLogger('job');

/**
 * Lifecycle seam for the per-character location-poll.
 *
 * Tracking enable/disable is a low-frequency operation (a user toggles it in
 * the map UI); it doesn't justify a long-lived `WorkerUtils` connection. We
 * enqueue via the SQL helper `graphile_worker.add_job` directly so this module
 * stays import-light and works from inside any request context (Server Action,
 * API route, future admin tool).
 *
 * The job key (`locationPollJobKey(characterId)`) is shared with the handler
 * itself — at most one in-flight + one pending poll exists per character.
 */

export interface StartTrackingArgs {
  mapId: bigint;
  characterId: bigint;
}

export type StartTrackingResult =
  | { ok: true; alreadyTracked: boolean }
  | { ok: false; error: 'map-missing' | 'map-soft-deleted' };

/**
 * Insert the (map, character) tracking row (idempotent — no-op if already
 * tracked) and enqueue the first `location-poll` for the character if one
 * isn't already scheduled. Returns `alreadyTracked: true` when the tracking
 * row already existed for this (map, character) pair.
 *
 * The handler is the one that decides what to do on its first tick (read
 * online state, persist, re-enqueue) — this function only fires the gun.
 */
export async function startTrackingCharacter(
  args: StartTrackingArgs,
): Promise<StartTrackingResult> {
  // Validate the map is live before persisting the subscription. A tracking
  // row pointing at a soft-deleted map would be harmless (the handler joins
  // through `WHERE deleted_at IS NULL`), but the failure mode of "I clicked
  // the toggle and nothing happened" is worse than a clean error here.
  jobLog.info('Starting tracking for character on map', {
    characterId: args.characterId,
    mapId: args.mapId,
  });
  const [map] = await db
    .select({ id: apMap.id, deletedAt: apMap.deletedAt })
    .from(apMap)
    .where(eq(apMap.id, args.mapId));
  if (!map) return { ok: false, error: 'map-missing' };
  if (map.deletedAt) return { ok: false, error: 'map-soft-deleted' };

  const inserted = await db
    .insert(apMapCharacterTracking)
    .values({ mapId: args.mapId, characterId: args.characterId })
    .onConflictDoNothing()
    .returning({ mapId: apMapCharacterTracking.mapId });
  const alreadyTracked = inserted.length === 0;

  // `preserve_run_at`: if a poll is already scheduled (from a prior `start`
  // call on a different map), keep its existing runAt — don't reset the clock.
  // If no job exists for this key, this acts as a normal insert with runAt = now().
  await db.execute(
    sql`SELECT graphile_worker.add_job(
          'location-poll',
          json_build_object('characterId', ${args.characterId.toString()}::text)::json,
          job_key => ${locationPollJobKey(args.characterId)},
          job_key_mode => 'preserve_run_at',
          run_at => now()
        )`,
  );

  return { ok: true, alreadyTracked };
}

export interface StopTrackingArgs {
  mapId: bigint;
  characterId: bigint;
}

/**
 * Delete the (map, character) tracking row. Returns whether a row was removed.
 *
 * Does **not** cancel the in-flight poll job. The handler's first action is to
 * check whether any tracking rows still exist for the character; on the next
 * tick after the last row goes away, the handler exits with
 * `{ stopped: 'no-tracking' }` and never re-enqueues. This avoids a race
 * between an in-flight handler reading the database and an external cancel.
 */
export async function stopTrackingCharacter(args: StopTrackingArgs): Promise<{ removed: boolean }> {
  const deleted = await db
    .delete(apMapCharacterTracking)
    .where(
      and(
        eq(apMapCharacterTracking.mapId, args.mapId),
        eq(apMapCharacterTracking.characterId, args.characterId),
      ),
    )
    .returning({ mapId: apMapCharacterTracking.mapId });
  return { removed: deleted.length > 0 };
}

/**
 * Drop a character's tracking on every map they can no longer view, and tell
 * live viewers to forget them. Called from the `character-cleanup` affiliation
 * sweep when a pilot's corp/alliance changed: once `canViewMap` is recomputed
 * against the fresh affiliation, any corp/alliance map they left falls away.
 *
 * For each map the character is tracked on (live maps only), if `canViewMap`
 * now returns false the `(map, character)` row is deleted and a
 * `characterLogout` is broadcast on that map so the roster drops the pilot
 * immediately. Maps they can still view (e.g. their own private maps, or a corp
 * map they remained in) are left untouched. The location-poll loop self-exits
 * on its next tick once no tracking rows remain.
 *
 * Returns the map ids that were pruned.
 */
export async function pruneTrackingForLostAccess(
  characterId: bigint,
): Promise<{ prunedMapIds: bigint[] }> {
  const rows = await db
    .select({ mapId: apMapCharacterTracking.mapId })
    .from(apMapCharacterTracking)
    .innerJoin(apMap, eq(apMap.id, apMapCharacterTracking.mapId))
    .where(
      and(eq(apMapCharacterTracking.characterId, characterId), isNull(apMap.deletedAt)),
    );

  const prunedMapIds: bigint[] = [];
  for (const { mapId } of rows) {
    if (await canViewMap(characterId, mapId)) continue;
    await db
      .delete(apMapCharacterTracking)
      .where(
        and(
          eq(apMapCharacterTracking.mapId, mapId),
          eq(apMapCharacterTracking.characterId, characterId),
        ),
      );
    await broadcastCharacterLogout(mapId, [characterId]);
    prunedMapIds.push(mapId);
  }
  return { prunedMapIds };
}

/**
 * Mirror of {@link pruneTrackingForLostAccess}. When a character **gains** map
 * access — joins/re-joins a corp, or is freshly registered as an alt onto an
 * account that has already auto-seeded maps — add a tracking row on every live
 * map where all of:
 *
 *   - the character's account has already auto-seeded the map (an
 *     `ap_map_tracking_seed` marker exists — i.e. the account opted this map
 *     into auto-tracking when it first opened it), and
 *   - no tracking row exists yet for `(map, character)`, and
 *   - the character can currently view the map (`canViewMap`).
 *
 * Each newly-tracked map enqueues the character's poll (`preserve_run_at`, so an
 * already-running loop keeps its cadence; the location-poll's next tick is what
 * re-adds the pilot to live rosters — no explicit broadcast here, symmetric with
 * `seedTrackingForMap`/`startTrackingCharacter`).
 *
 * Gating on the seed marker keeps this account-centric: a re-joining or new
 * character is auto-tracked only on maps the account already auto-tracks, never
 * on maps the account has never opened (those get seeded when the account next
 * opens them). A non-`active` character (kicked/banned) is skipped — consistent
 * with `seedTrackingForMap`, which only seeds active characters.
 *
 * Called from the sign-in JWT callback (immediate re-track on re-login / add-
 * alt) and the `character-cleanup` affiliation sweep (re-track on corp re-join
 * without a fresh login, bounded by the cron tick). Idempotent.
 *
 * Returns the map ids a tracking row was added on.
 */
export async function seedTrackingForGainedAccess(
  characterId: bigint,
): Promise<{ seededMapIds: bigint[] }> {
  const [owner] = await db
    .select({ userId: apCharacter.userId, status: apCharacter.status })
    .from(apCharacter)
    .where(eq(apCharacter.id, characterId));
  if (!owner || owner.status !== 'active') return { seededMapIds: [] };

  // Candidate maps: live maps this account has already auto-seeded, on which the
  // character has no tracking row yet (anti-join on the LEFT-joined tracking row).
  const candidates = await db
    .select({ mapId: apMapTrackingSeed.mapId })
    .from(apMapTrackingSeed)
    .innerJoin(apMap, eq(apMap.id, apMapTrackingSeed.mapId))
    .leftJoin(
      apMapCharacterTracking,
      and(
        eq(apMapCharacterTracking.mapId, apMapTrackingSeed.mapId),
        eq(apMapCharacterTracking.characterId, characterId),
      ),
    )
    .where(
      and(
        eq(apMapTrackingSeed.userId, owner.userId),
        isNull(apMap.deletedAt),
        isNull(apMapCharacterTracking.mapId),
      ),
    );

  const seededMapIds: bigint[] = [];
  for (const { mapId } of candidates) {
    if (!(await canViewMap(characterId, mapId))) continue;
    await db
      .insert(apMapCharacterTracking)
      .values({ mapId, characterId })
      .onConflictDoNothing();
    await db.execute(
      sql`SELECT graphile_worker.add_job(
            'location-poll',
            json_build_object('characterId', ${characterId.toString()}::text)::json,
            job_key => ${locationPollJobKey(characterId)},
            job_key_mode => 'preserve_run_at',
            run_at => now()
          )`,
    );
    seededMapIds.push(mapId);
  }
  return { seededMapIds };
}

export interface SeedTrackingArgs {
  mapId: bigint;
  userId: number;
}

/**
 * The per-map default: the first time an account opens a map, track all its
 * active characters. Idempotent and
 * gated by the `ap_map_tracking_seed` marker so the auto-add fires exactly once
 * per `(map, account)` — after that the user's explicit per-map selection
 * stands, *including selecting zero* (an empty selection is no longer mistaken
 * for a fresh map).
 *
 * In one transaction: `INSERT … ON CONFLICT DO NOTHING` the seed marker; if the
 * marker was freshly inserted, select the account's `active` characters and
 * upsert a `(mapId, characterId)` tracking row for each, then enqueue each
 * character's poll with `preserve_run_at` (an already-running loop keeps its
 * cadence). When the marker already exists this is a no-op — the join table is
 * left exactly as the user configured it.
 *
 * The caller is responsible for the map being viewable/live (this is the
 * realtime-subscribe seam, downstream of `canViewMap`).
 */
export async function seedTrackingForMap(args: SeedTrackingArgs): Promise<void> {
  await db.transaction(async (tx) => {
    const marker = await tx
      .insert(apMapTrackingSeed)
      .values({ mapId: args.mapId, userId: args.userId })
      .onConflictDoNothing()
      .returning({ mapId: apMapTrackingSeed.mapId });
    // Marker already existed → this account has configured this map before.
    // Leave the selection untouched (including an intentional empty set).
    if (marker.length === 0) return;

    const characters = await tx
      .select({ id: apCharacter.id })
      .from(apCharacter)
      .where(and(eq(apCharacter.userId, args.userId), eq(apCharacter.status, 'active')));

    for (const { id: characterId } of characters) {
      await tx
        .insert(apMapCharacterTracking)
        .values({ mapId: args.mapId, characterId })
        .onConflictDoNothing();
      await tx.execute(
        sql`SELECT graphile_worker.add_job(
              'location-poll',
              json_build_object('characterId', ${characterId.toString()}::text)::json,
              job_key => ${locationPollJobKey(characterId)},
              job_key_mode => 'preserve_run_at',
              run_at => now()
            )`,
      );
    }
  });
}
