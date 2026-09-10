// @vitest-environment node
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, pool } from '@/db/client';
import { apCharacter, apMap, apUser } from '@/db/schema';
import { commitMapEvent } from '@/lib/map/mutations/core';
import { listViewableMaps } from '@/lib/map/loadMap';
import { mapEventPayloadSchema } from '@/lib/realtime/protocol';

/**
 * The Server Actions (`createMapAction`/`deleteMapAction`/
 * `updateMapSettingsAction`) wrap `requireSession` + `commitMapEvent` + a
 * `revalidatePath`; the session/redirect layer can't run headless, so this
 * drives the same DB pipeline the actions use and asserts the user-visible
 * outcome: create lands one `map.create` event + shows in `listViewableMaps`;
 * soft-delete lands one `map.delete` event + drops out of `listViewableMaps`.
 *
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test
 */
const run = process.env.RUN_DB_TESTS === '1';

let mapId = 0n;
// `listViewableMaps` requires a viewer. Use a synthetic admin so
// the test still asserts "the row appears in the viewer-scoped query".
const TEST_VIEWER_ID = 98030001n;
let testUserId = 0;

describe.skipIf(!run)('map CRUD pipeline (real Postgres)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    const [u] = await db.insert(apUser).values({}).returning({ id: apUser.id });
    testUserId = u!.id;
    await db.insert(apCharacter).values({
      id: TEST_VIEWER_ID,
      userId: testUserId,
      name: 'CRUD Test Viewer',
      ownerHash: 'crud-test-hash',
      authzLevel: 'admin',
    });
  });

  afterAll(async () => {
    if (mapId) await db.delete(apMap).where(eq(apMap.id, mapId));
    await db.delete(apCharacter).where(eq(apCharacter.id, TEST_VIEWER_ID));
    if (testUserId) await db.delete(apUser).where(eq(apUser.id, testUserId));
    await pool.end();
  });

  it('map.create lands one event and the map shows in listViewableMaps', async () => {
    const [seq] = (
      await db.execute(sql`SELECT nextval(pg_get_serial_sequence('ap_map','id')) AS id`)
    ).rows as Array<{ id: string }>;
    mapId = BigInt(seq!.id);

    const created = await commitMapEvent({
      mapId,
      characterId: null,
      kind: 'map.create',
      mutate: async (tx) => {
        await tx
          .insert(apMap)
          .values({ id: mapId, name: 'CRUD Test Map', scope: 'wh', type: 'private' });
        return {
          id: mapId.toString(),
          name: 'CRUD Test Map',
          scope: 'wh' as const,
          type: 'private' as const,
        };
      },
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(() => mapEventPayloadSchema.parse(created.data)).not.toThrow();
    expect(created.data).toMatchObject({ kind: 'map.create', name: 'CRUD Test Map', scope: 'wh' });

    const list = await listViewableMaps(TEST_VIEWER_ID);
    expect(list.some((m) => m.id === mapId.toString())).toBe(true);
    expect(await eventCount('map.create')).toBe(1);
  });

  it('map.update emits only the changed fields', async () => {
    const updated = await commitMapEvent({
      mapId,
      characterId: null,
      kind: 'map.update',
      mutate: async (tx) => {
        await tx.update(apMap).set({ name: 'CRUD Renamed' }).where(eq(apMap.id, mapId));
        return { id: mapId.toString(), name: 'CRUD Renamed' };
      },
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.data).toEqual({ kind: 'map.update', eventId: updated.eventId, id: mapId.toString(), name: 'CRUD Renamed' });
  });

  it('map.delete soft-deletes (sets deleted_at) and drops out of listViewableMaps', async () => {
    const deleted = await commitMapEvent({
      mapId,
      characterId: null,
      kind: 'map.delete',
      mutate: async (tx) => {
        const now = new Date();
        await tx.update(apMap).set({ deletedAt: now }).where(eq(apMap.id, mapId));
        return { id: mapId.toString(), deletedAt: now.toISOString() };
      },
    });
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    expect(deleted.data).toMatchObject({ kind: 'map.delete' });

    const list = await listViewableMaps(TEST_VIEWER_ID);
    expect(list.some((m) => m.id === mapId.toString())).toBe(false);

    // Soft delete, not hard delete: the row persists with deleted_at set.
    const [row] = await db
      .select({ deletedAt: apMap.deletedAt })
      .from(apMap)
      .where(eq(apMap.id, mapId));
    expect(row?.deletedAt).toBeInstanceOf(Date);
  });
});

async function eventCount(kind: string): Promise<number> {
  const rows = (
    await db.execute(
      sql`SELECT count(*)::int AS count FROM ap_map_event WHERE map_id = ${mapId} AND kind = ${kind}`,
    )
  ).rows as Array<{ count: number }>;
  return rows[0]!.count;
}
