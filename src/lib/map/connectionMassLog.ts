// No `import 'server-only'`: this module is reached by the location-poll job
// chain (tracking.ts → wsServer.ts), which the custom `server.ts` loads via tsx
// outside Next's bundler where the `server-only` shim doesn't resolve. Same
// precedent as `locationCommit.ts` / `bus.ts`. It is only ever imported by
// server code (the poll + the API route).
import { and, desc, eq, sql } from 'drizzle-orm';
import { apertureConfig } from '../../../aperture.config';
import { db } from '@/db/client';
import { apCharacter, apMapConnection, apMapConnectionLog, universeType } from '@/db/schema';
import type { ConnectionMassLogEntry } from '@/types';

/**
 * Server-side writer for the connection mass-log. Called from the
 * location-poll's wormhole-jump fold (`src/lib/jobs/locationCommit.ts`) when a
 * tracked character traverses a connection.
 *
 * This deliberately **bypasses `ap_map_event`**: the mass-log is a server-observed
 * transient with its own durable table + audit, not part of `MapViewData`. Like
 * `characterUpdate` / `systemNotification` it fans out with a direct `pg_notify`
 * on the `map:<id>` channel under the `connectionMassLog` task (see
 * `src/lib/realtime/bus.ts`).
 */

export interface LogConnectionJumpArgs {
  mapId: bigint;
  connectionId: bigint;
  characterId: bigint | null;
  shipTypeId: number | null;
  /** kg for this jump; null skips the log (an unresolved mass would corrupt the cumulative). */
  mass: number | null;
}

/**
 * Insert one jump into the log and broadcast it. No-op when `mass` is null —
 * keeps the NOT-NULL column and the running cumulative meaningful.
 */
export async function logConnectionJump(args: LogConnectionJumpArgs): Promise<void> {
  if (args.mass === null) {
    console.warn(
      'connection mass-log skipped: unresolved ship mass (map=%s connection=%s shipType=%s)',
      args.mapId.toString(),
      args.connectionId.toString(),
      args.shipTypeId,
    );
    return;
  }
  const massKg = BigInt(Math.round(args.mass));
  console.log(
    'logging connection jump: map=%s connection=%s character=%s shipType=%s mass=%d kg',
    args.mapId.toString(),
    args.connectionId.toString(),
    args.characterId?.toString() ?? null,
    args.shipTypeId,
    Number(massKg)
  );

  const [row] = await db
    .insert(apMapConnectionLog)
    .values({
      connectionId: args.connectionId,
      characterId: args.characterId,
      shipTypeId: args.shipTypeId,
      mass: massKg,
    })
    .returning({ id: apMapConnectionLog.id, jumpedAt: apMapConnectionLog.jumpedAt });
  if (!row) {
    console.error(
      'failed to log connection jump: insert did not return id (map=%s connection=%s character=%s shipType=%s mass=%d kg)',
      args.mapId.toString(),
      args.connectionId.toString(),
      args.characterId?.toString() ?? null,
      args.shipTypeId,
      Number(massKg)
    );
  }
  if (row) {
    console.log('logged connection jump: logId=%s jumpedAt=%s', row.id.toString(), row.jumpedAt.toISOString());
  }

  // Running cumulative includes the row just inserted. Sum stays well within
  // JS safe-int range (a hole's max stable mass is ~3e9 kg).
  const cumulativeRows = await db.execute<{ total: string }>(
    sql`SELECT COALESCE(SUM(${apMapConnectionLog.mass}), 0)::bigint AS total
        FROM ${apMapConnectionLog}
        WHERE ${apMapConnectionLog.connectionId} = ${args.connectionId}`,
  );
  const cumulativeMass = Number(cumulativeRows.rows[0]?.total ?? '0');

  const channel = `${apertureConfig.MAP_EVENT_NOTIFY_CHANNEL_PREFIX}${args.mapId.toString()}`;
  const envelope = JSON.stringify({
    task: 'connectionMassLog',
    load: {
      mapId: Number(args.mapId),
      connectionId: args.connectionId.toString(),
      logId: row!.id.toString(),
      characterId: args.characterId !== null ? Number(args.characterId) : null,
      shipTypeId: args.shipTypeId,
      mass: Number(massKg),
      cumulativeMass,
      jumpedAt: row!.jumpedAt.toISOString(),
    },
  });
  await db.execute(sql`SELECT pg_notify(${channel}, ${envelope})`);
}

/**
 * List a connection's mass-log for display, newest jump first. Each entry's
 * `cumulativeMass` is the chronological running total up to and including that
 * jump (a SQL window function over ascending `jumped_at`/`id`), so it stays
 * correct under the descending display sort. Scoped to `mapId` so a connection
 * id from another map can't be read through this map's route. Returns `[]` when
 * the connection isn't on the map.
 */
export async function listConnectionMassLog(args: {
  mapId: bigint;
  connectionId: bigint;
}): Promise<ConnectionMassLogEntry[]> {
  const rows = await db
    .select({
      id: apMapConnectionLog.id,
      characterId: apMapConnectionLog.characterId,
      characterName: apCharacter.name,
      shipTypeId: apMapConnectionLog.shipTypeId,
      shipTypeName: universeType.name,
      mass: apMapConnectionLog.mass,
      jumpedAt: apMapConnectionLog.jumpedAt,
      // Window function computes the running cumulative in chronological order
      // regardless of the outer DESC sort, so each entry carries the correct
      // "mass used up to and including this jump" value.
      cumulativeMass: sql<string>`SUM(${apMapConnectionLog.mass}) OVER (ORDER BY ${apMapConnectionLog.jumpedAt} ASC, ${apMapConnectionLog.id} ASC)`,
    })
    .from(apMapConnectionLog)
    .innerJoin(apMapConnection, eq(apMapConnection.id, apMapConnectionLog.connectionId))
    .leftJoin(apCharacter, eq(apCharacter.id, apMapConnectionLog.characterId))
    .leftJoin(universeType, eq(universeType.id, apMapConnectionLog.shipTypeId))
    .where(
      and(
        eq(apMapConnectionLog.connectionId, args.connectionId),
        eq(apMapConnection.mapId, args.mapId),
      ),
    )
    .orderBy(desc(apMapConnectionLog.jumpedAt), desc(apMapConnectionLog.id));

  return rows.map((r) => ({
    id: r.id.toString(),
    characterId: r.characterId !== null ? r.characterId.toString() : null,
    characterName: r.characterName ?? null,
    shipTypeId: r.shipTypeId,
    shipTypeName: r.shipTypeName ?? null,
    mass: Number(r.mass),
    cumulativeMass: Number(r.cumulativeMass),
    jumpedAt: r.jumpedAt.toISOString(),
  }));
}
