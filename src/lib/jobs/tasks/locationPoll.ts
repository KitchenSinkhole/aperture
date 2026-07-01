import { and, eq, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { JobHelpers } from 'graphile-worker';
import { apertureConfig } from '../../../../aperture.config';
import { db } from '@/db/client';
import {
  apCharacter,
  apMap,
  apMapCharacterTracking,
  apUser,
  universeSystem,
  universeType,
} from '@/db/schema';
import {
  esiCall,
  EsiBreakerOpenError,
  EsiDowntimeError,
  EsiHttpError,
  EsiTokenError,
} from '@/lib/esi/client';
import {
  characterOnlineSchema,
  characterShipSchema,
  locationSchema,
} from '@/lib/esi/decoders';
import { classifyJump, type JumpClass } from '@/lib/map/locationToConnection';
import { logConnectionJump } from '@/lib/map/connectionMassLog';
import { getMapViewerUserIds } from '@/lib/realtime/mapViewers';
import { shipMass } from '@/lib/eve/shipMass';
import { recordLocationPoll } from '@/lib/metrics/registry';
import { foldWormholeJumpOntoMap } from '../locationCommit';
import { withInstrumentation } from '../withInstrumentation';
import type { JobModule } from '../registry';
import type { LocationPollOutcome } from '@/types';

/**
 * Per-character location-poll. Scheduled via `addJob` only — no cron entry;
 * the *handler itself* re-enqueues the next tick with an adaptive delay (5s
 * online, 60s offline). The first enqueue happens via `startTrackingCharacter`
 * (`src/lib/jobs/tracking.ts`); from then on the loop is self-perpetuating
 * until either tracking rows are removed or the loop exits with a stop reason.
 *
 * Stage-by-stage scope:
 *   - 12.1: observe online state + location + ship, persist on `ap_character`.
 *   - 12.2: classify gate vs wormhole, fold wormhole jumps onto tracked maps
 *           as `system.added` / `connection.create` events.
 *   - 12.3: stop cleanly on token loss / status change, emit `characterUpdate`
 *           broadcasts so other tabs see the breadcrumb.
 *
 * Stop reasons (handler returns success=true with `notes.stopped` set; no
 * re-enqueue is scheduled):
 *   - `no-tracking`        — no `ap_map_character_tracking` rows for this id.
 *   - `character-missing`  — `ap_character` row gone (account erased).
 *   - `character-inactive` — status is `kicked` / `banned`.
 *   - `token-loss`         — `EsiTokenError` from any ESI call; tracking rows
 *                            for the character are deleted (a future
 *                            re-authenticate + `startTrackingCharacter` re-arms
 *                            the loop).
 */

const NAME = 'location-poll';

const LOCATION_POLL_JOB_KEY_PREFIX = 'location-poll:';

interface LocationPollPayload {
  characterId: string; // bigint stringified — JSON has no bigint
}

interface FoldSummary {
  mapId: string;
  fromSystemAdded: boolean;
  toSystemAdded: boolean;
  connectionCreated: boolean;
  /**
   * Whether the moving pilot's account had this map open, so the jump was
   * allowed to add a system not already on the map. When `false`, the jump only
   * recorded movement between already-visible systems (or did nothing).
   */
  addNewSystems: boolean;
}

interface PollNotes {
  stopped?:
    | 'no-payload'
    | 'no-tracking'
    | 'character-inactive'
    | 'character-missing'
    | 'token-loss';
  online?: boolean;
  previousSystemId?: number | null;
  currentSystemId?: number | null;
  reenqueuedInMs?: number;
  esiOutage?: 'breaker-open' | 'downtime';
  jumpClass?: JumpClass | null;
  folds?: FoldSummary[];
}

async function poll(payload: LocationPollPayload, helpers: JobHelpers): Promise<PollNotes> {
  // A graphile-worker payload is data crossing into the handler — guard it.
  // A payload-less enqueue (e.g. an operator triggering this from the `/setup`
  // console) would otherwise crash on `BigInt(undefined)` and burn all 25
  // retries. Stop cleanly instead; nothing re-enqueues.
  if (!payload?.characterId) {
    return { stopped: 'no-payload' };
  }
  const characterId = BigInt(payload.characterId);

  // Step 1 — bail early if the character isn't tracked anywhere. The
  // `ap_map_character_tracking_character_idx` index covers this query.
  const trackingProbe = await db.execute<{ has_row: boolean }>(
    sql`SELECT EXISTS (
          SELECT 1 FROM ap_map_character_tracking WHERE character_id = ${characterId}
        ) AS has_row`,
  );
  if (!trackingProbe.rows[0]?.has_row) {
    return { stopped: 'no-tracking' };
  }

  // Step 2 — load last-known state + status. Status gate keeps a kicked/banned
  // character from continuing to consume their token bucket; `lastShipTypeId`
  // and `lastLocationAt` are read so the offline-branch broadcast can carry
  // the breadcrumb even when the offline tick itself doesn't refresh location.
  // Self-join ap_character to resolve the account's main name (ap_user.main_character_id)
  // so every characterUpdate broadcast can carry the pilot's account + main identity.
  const mainCharacter = alias(apCharacter, 'main_character');
  const [character] = await db
    .select({
      name: apCharacter.name,
      status: apCharacter.status,
      userId: apCharacter.userId,
      mainCharacterId: apUser.mainCharacterId,
      mainCharacterName: mainCharacter.name,
      lastSystemId: apCharacter.lastSystemId,
      lastShipTypeId: apCharacter.lastShipTypeId,
      lastShipName: apCharacter.lastShipName,
      lastLocationAt: apCharacter.lastLocationAt,
    })
    .from(apCharacter)
    .innerJoin(apUser, eq(apUser.id, apCharacter.userId))
    .leftJoin(mainCharacter, eq(mainCharacter.id, apUser.mainCharacterId))
    .where(eq(apCharacter.id, characterId));
  if (!character) {
    return { stopped: 'character-missing' };
  }
  if (character.status !== 'active') {
    return { stopped: 'character-inactive' };
  }

  try {
    // Step 3 — online probe.
    const onlineProbe = await esiCall('getCharacterOnline', {
      schema: characterOnlineSchema,
      pathParams: { character_id: characterId },
      characterId,
    });

    // Step 4 — list the maps that should see this character's broadcast / fan-out.
    const trackedMapIds = await loadActiveTrackedMaps(characterId);

    // Step 5 — offline tick: stamp the flag, broadcast the breadcrumb on every
    // tracked map channel, push the next tick out to the slower cadence.
    if (!onlineProbe.online) {
      await db
        .update(apCharacter)
        .set({ lastOnline: false, updatedAt: sql`now()` })
        .where(eq(apCharacter.id, characterId));
      const reenqueuedInMs = apertureConfig.LOCATION_POLL_OFFLINE_MS;
      await reenqueue(helpers, payload, reenqueuedInMs);
      await broadcastCharacterUpdate({
        trackedMapIds,
        characterId,
        characterName: character.name,
        userId: character.userId,
        mainCharacterId: character.mainCharacterId,
        mainCharacterName: character.mainCharacterName,
        online: false,
        systemId: character.lastSystemId,
        shipTypeId: character.lastShipTypeId,
        shipName: character.lastShipName,
        locationAt: character.lastLocationAt,
      });
      return { online: false, previousSystemId: character.lastSystemId, reenqueuedInMs };
    }

    // Step 6 — online: pull location + ship in parallel, persist, re-enqueue
    // at the fast cadence.
    const [location, ship] = await Promise.all([
      esiCall('getCharacterLocation', { schema: locationSchema, pathParams: { character_id: characterId }, characterId }),
      esiCall('getCharacterShip', { schema: characterShipSchema, pathParams: { character_id: characterId }, characterId }),
    ]);
    const locationAt = new Date();
    await db
      .update(apCharacter)
      .set({
        lastSystemId: location.solar_system_id,
        lastShipTypeId: ship.ship_type_id,
        lastShipName: ship.ship_name,
        lastOnline: true,
        lastLocationAt: locationAt,
        updatedAt: locationAt,
      })
      .where(eq(apCharacter.id, characterId));

    const reenqueuedInMs = apertureConfig.LOCATION_POLL_ONLINE_MS;
    await reenqueue(helpers, payload, reenqueuedInMs);

    // Step 7 — classify + fan-out. First poll (`previousSystemId === null`)
    // and same-system ticks both short-circuit. Gate jumps and `teleport`
    // (pod self-destruct / podded / jump clone — arrived docked in k-space)
    // are observed-only: location is already persisted, so we just don't fold.
    let jumpClass: JumpClass | null = null;
    let folds: FoldSummary[] | undefined;
    if (
      character.lastSystemId !== null &&
      location.solar_system_id !== character.lastSystemId
    ) {
      jumpClass = await classifyJump({
        fromSystemId: character.lastSystemId,
        toSystemId: location.solar_system_id,
        arrivedDocked: location.station_id != null || location.structure_id != null,
      });
      if (jumpClass === 'wormhole') {
        // Resolve the jumping ship's mass once (same ship across every tracked
        // map) for the per-connection mass-log. Null when the type is unknown —
        // `logConnectionJump` skips logging that jump.
        const jumpMass = await shipMass(ship.ship_type_id);
        folds = [];
        for (const mapId of trackedMapIds) {
          // A jump may add a system not already on the map only when the moving
          // pilot's account currently has *this* map open in a live tab. The WS
          // viewer roster is in-process (`server.ts` runs the worker beside the
          // WS server) and account-keyed. With the map closed, the fold records
          // movement only between systems already placed — so a pilot
          // day-tripping with Aperture closed doesn't pollute a dormant map.
          const addNewSystems = getMapViewerUserIds(mapId).includes(character.userId);
          const result = await foldWormholeJumpOntoMap({
            mapId,
            characterId,
            fromSystemId: character.lastSystemId,
            toSystemId: location.solar_system_id,
            addNewSystems,
          });
          // No connection means the jump was suppressed (map closed, endpoint
          // off-map) — nothing to log a jump's mass against.
          if (result.connectionId !== null) {
            await logConnectionJump({
              mapId,
              connectionId: result.connectionId,
              characterId,
              shipTypeId: ship.ship_type_id,
              mass: jumpMass,
            });
          }
          folds.push({
            mapId: mapId.toString(),
            fromSystemAdded: result.fromSystemAdded,
            toSystemAdded: result.toSystemAdded,
            connectionCreated: result.connectionCreated,
            addNewSystems,
          });
        }
      }
    }

    // Step 8 — broadcast the breadcrumb to every tracked map channel. Goes
    // out *after* the fold so the client receives `system.added` /
    // `connection.create` first and the `characterUpdate` lands on a canvas
    // that already knows the new system.
    await broadcastCharacterUpdate({
      trackedMapIds,
      characterId,
      characterName: character.name,
      userId: character.userId,
      mainCharacterId: character.mainCharacterId,
      mainCharacterName: character.mainCharacterName,
      online: true,
      systemId: location.solar_system_id,
      shipTypeId: ship.ship_type_id,
      shipName: ship.ship_name,
      locationAt,
    });

    return {
      online: true,
      previousSystemId: character.lastSystemId,
      currentSystemId: location.solar_system_id,
      reenqueuedInMs,
      jumpClass,
      ...(folds ? { folds } : {}),
    };
  } catch (err) {
    if (err instanceof EsiTokenError) {
      // Token is unusable — stop polling this character. Tracking rows go away
      // so a future tick (e.g. if one is already enqueued) also exits cleanly
      // via the step-1 probe. Re-enabling tracking requires the user to
      // re-authenticate and call `startTrackingCharacter` again.
      await db
        .delete(apMapCharacterTracking)
        .where(eq(apMapCharacterTracking.characterId, characterId));
      return { stopped: 'token-loss' };
    }
    if (
      err instanceof EsiBreakerOpenError ||
      err instanceof EsiDowntimeError ||
      // A 401 that survived the client's force-refresh-and-retry: the refresh
      // worked (so the token isn't dead — not `EsiTokenError`), but ESI keeps
      // rejecting it. Almost always a CCP-side blip; back off and keep the loop
      // (and the tracking rows) alive rather than burning graphile retries.
      (err instanceof EsiHttpError && err.status === 401)
    ) {
      // ESI is in trouble — back off to the offline cadence and let
      // withInstrumentation record the failure. The loop survives.
      await reenqueue(helpers, payload, apertureConfig.LOCATION_POLL_OFFLINE_MS);
      throw err;
    }
    throw err;
  }
}

/**
 * Map a poll's result (or a known ESI back-off throw) to its bounded outcome
 * label, so `location_polls_total` carries one tally per invocation without a
 * per-character label. Unexpected throws (handler bugs) go uncounted — they're
 * not a tracking-health signal.
 */
function pollOutcome(notes: PollNotes): LocationPollOutcome {
  if (notes.stopped) return notes.stopped;
  return notes.online ? 'online' : 'offline';
}

async function instrumentedPoll(
  payload: LocationPollPayload,
  helpers: JobHelpers,
): Promise<PollNotes> {
  try {
    const notes = await poll(payload, helpers);
    recordLocationPoll(pollOutcome(notes));
    return notes;
  } catch (err) {
    if (
      err instanceof EsiBreakerOpenError ||
      err instanceof EsiDowntimeError ||
      (err instanceof EsiHttpError && err.status === 401)
    ) {
      recordLocationPoll('esi-outage');
    }
    throw err;
  }
}

async function loadActiveTrackedMaps(characterId: bigint): Promise<bigint[]> {
  const rows = await db
    .select({ mapId: apMap.id })
    .from(apMapCharacterTracking)
    .innerJoin(apMap, eq(apMap.id, apMapCharacterTracking.mapId))
    .where(
      and(eq(apMapCharacterTracking.characterId, characterId), isNull(apMap.deletedAt)),
    );
  return rows.map((r) => r.mapId);
}

interface BroadcastArgs {
  trackedMapIds: bigint[];
  characterId: bigint;
  characterName: string;
  userId: number;
  mainCharacterId: bigint | null;
  mainCharacterName: string | null;
  online: boolean;
  systemId: number | null;
  shipTypeId: number | null;
  shipName: string | null;
  locationAt: Date | null;
}

async function broadcastCharacterUpdate(args: BroadcastArgs): Promise<void> {
  if (args.trackedMapIds.length === 0) return;
  // Resolve the ship type name once per tick so every subscribed client can
  // render the hover panel without doing its own SDE lookup. Null when no ship
  // type is known yet, or when the typeId disappears between SDE rebuilds.
  let shipTypeName: string | null = null;
  if (args.shipTypeId !== null) {
    const [row] = await db
      .select({ name: universeType.name })
      .from(universeType)
      .where(eq(universeType.id, args.shipTypeId));
    shipTypeName = row?.name ?? null;
  }
  // Resolve the location name + class so the Map Info pilot roster can label a
  // pilot in a system that isn't placed on the map. Null when offline / unlocated
  // or the id disappears between SDE rebuilds.
  let systemName: string | null = null;
  let systemSecurity: string | null = null;
  let systemTrueSec: number | null = null;
  if (args.systemId !== null) {
    const [row] = await db
      .select({
        name: universeSystem.name,
        security: universeSystem.security,
        trueSec: universeSystem.trueSec,
      })
      .from(universeSystem)
      .where(eq(universeSystem.id, args.systemId));
    systemName = row?.name ?? null;
    systemSecurity = row?.security ?? null;
    systemTrueSec = row?.trueSec ?? null;
  }
  // The bus discriminates by the top-level `task` field — see `src/lib/realtime/bus.ts`.
  const envelope = JSON.stringify({
    task: 'characterUpdate',
    load: {
      characterId: Number(args.characterId),
      characterName: args.characterName,
      userId: args.userId,
      mainCharacterId: args.mainCharacterId === null ? null : Number(args.mainCharacterId),
      mainCharacterName: args.mainCharacterName,
      online: args.online,
      systemId: args.systemId,
      systemName,
      systemSecurity,
      systemTrueSec,
      shipTypeId: args.shipTypeId,
      shipTypeName,
      shipName: args.shipName,
      locationAt: args.locationAt ? args.locationAt.toISOString() : null,
    },
  });
  for (const mapId of args.trackedMapIds) {
    const channel = `${apertureConfig.MAP_EVENT_NOTIFY_CHANNEL_PREFIX}${mapId.toString()}`;
    await db.execute(sql`SELECT pg_notify(${channel}, ${envelope})`);
  }
}

async function reenqueue(
  helpers: JobHelpers,
  payload: LocationPollPayload,
  delayMs: number,
): Promise<void> {
  await helpers.addJob(NAME, payload, {
    runAt: new Date(Date.now() + delayMs),
    jobKey: locationPollJobKey(payload.characterId),
    jobKeyMode: 'replace',
  });
}

/** Stable job key per character — keeps at most one in-flight + one pending poll per character. */
export function locationPollJobKey(characterId: bigint | string): string {
  return `${LOCATION_POLL_JOB_KEY_PREFIX}${characterId}`;
}

export const locationPoll: JobModule = {
  name: NAME,
  // No cron — scheduled via `addJob` only. `startTrackingCharacter` enqueues
  // the first tick; the handler re-enqueues itself thereafter.
  run: withInstrumentation(NAME, instrumentedPoll),
};
