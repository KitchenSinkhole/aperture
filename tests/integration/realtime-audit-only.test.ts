// @vitest-environment node
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, pool } from '@/db/client';
import { apMap, apMapEvent } from '@/db/schema';
import { commitMapEvent } from '@/lib/map/mutations/core';
import { bus } from '@/lib/realtime/bus';
import type { ServerToClientMessage } from '@/lib/realtime/protocol';

/**
 * Audit-only event kinds reach `ap_map_event` but are never fanned out to
 * sockets: the bus drops them, while an ordinary map event on the same map
 * still arrives.
 *
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test realtime-audit-only
 */
const run = process.env.RUN_DB_TESTS === '1';
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

let mapId = 0n;

describe.skipIf(!run)('audit-only event fan-out (real Postgres)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    const [m] = await db
      .insert(apMap)
      .values({ name: 'Audit-only fan-out map', scope: 'wh', type: 'private' })
      .returning({ id: apMap.id });
    mapId = m!.id;
  });

  afterAll(async () => {
    await db.delete(apMapEvent).where(eq(apMapEvent.mapId, mapId));
    await db.delete(apMap).where(eq(apMap.id, mapId));
    await pool.end();
  });

  it('records token events but broadcasts only the ordinary event', async () => {
    const received: ServerToClientMessage[] = [];
    const unsubscribe = bus.subscribe(mapId, (msg) => received.push(msg));
    await delay(200); // let the bus register its LISTEN before pg_notify fires

    const created = await commitMapEvent({
      mapId,
      characterId: null,
      kind: 'api.token_created',
      mutate: async () => ({ tokenId: '1', label: 'chain bot', scopes: ['map' as const], expiresAt: null }),
    });
    const revoked = await commitMapEvent({
      mapId,
      characterId: null,
      kind: 'api.token_revoked',
      mutate: async () => ({ tokenId: '1', label: 'chain bot', reason: 'manager' as const }),
    });
    const disabled = await commitMapEvent({
      mapId,
      characterId: null,
      kind: 'api.disabled',
      mutate: async () => ({}),
    });
    await delay(500); // pg_notify is fire-and-forget across connections
    unsubscribe();

    expect([created.ok, revoked.ok, disabled.ok]).toEqual([true, true, true]);
    const kinds = await db
      .select({ kind: apMapEvent.kind })
      .from(apMapEvent)
      .where(eq(apMapEvent.mapId, mapId));
    expect(kinds.map((k) => k.kind).sort()).toEqual(
      ['api.disabled', 'api.token_created', 'api.token_revoked'],
    );
    const broadcast = received.flatMap((m) => (m.task === 'mapUpdate' ? [m.load.kind] : []));
    expect(broadcast).toEqual(['api.disabled']);
  });
});
