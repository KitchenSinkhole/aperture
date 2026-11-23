// @vitest-environment node
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { and, desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db, pool } from '@/db/client';
import { apCharacter, apMap, apMapEvent, apUser } from '@/db/schema';
import { loadMapSettings } from '@/lib/map/loadMap';
import { mapEventPayloadSchema } from '@/lib/realtime/protocol';

/**
 * The Settings → Behavior tab's Save (`updateMapSettingsAction`) against real
 * Postgres, with `requireSession` mocked. Ids use a 9745xxxx block.
 *
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test map-behavior-settings
 */
const run = process.env.RUN_DB_TESTS === '1';

const h = vi.hoisted(() => ({ characterId: '0' }));
vi.mock('@/lib/session', () => ({
  requireSession: async () => ({ characterId: h.characterId, userId: 0 }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { updateMapSettingsAction } = await import('@/app/(app)/actions/map');

const OWNER = 97450001n;
const OUTSIDER = 97450002n;
const userIds: number[] = [];
let mapId = 0n;

async function storedAutoEol(): Promise<boolean> {
  const [row] = await db
    .select({ autoEolConnections: apMap.autoEolConnections })
    .from(apMap)
    .where(eq(apMap.id, mapId));
  return row!.autoEolConnections;
}

async function lastMapUpdatePayload() {
  const [row] = await db
    .select({ payload: apMapEvent.payload })
    .from(apMapEvent)
    .where(and(eq(apMapEvent.mapId, mapId), eq(apMapEvent.kind, 'map.update')))
    .orderBy(desc(apMapEvent.id))
    .limit(1);
  return mapEventPayloadSchema.parse(row!.payload);
}

describe.skipIf(!run)('map behavior settings action (real Postgres)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    for (const [id, name] of [
      [OWNER, 'Behavior Owner'],
      [OUTSIDER, 'Behavior Outsider'],
    ] as const) {
      const [u] = await db.insert(apUser).values({}).returning({ id: apUser.id });
      userIds.push(u!.id);
      await db.insert(apCharacter).values({ id, userId: u!.id, name, ownerHash: `hash-${id}` });
    }
    const [m] = await db
      .insert(apMap)
      .values({
        name: 'Behavior Settings Map',
        scope: 'wh',
        type: 'private',
        ownerCharacterId: OWNER,
      })
      .returning({ id: apMap.id });
    mapId = m!.id;
  });

  afterAll(async () => {
    if (mapId) await db.delete(apMap).where(eq(apMap.id, mapId));
    for (const id of [OWNER, OUTSIDER]) await db.delete(apCharacter).where(eq(apCharacter.id, id));
    for (const id of userIds) await db.delete(apUser).where(eq(apUser.id, id));
    await pool.end();
  });

  it('a new map starts with auto-EOL off', async () => {
    expect(await storedAutoEol()).toBe(false);
    expect((await loadMapSettings(OWNER, mapId))!.autoEolConnections).toBe(false);
  });

  it('the owner turning auto-EOL on persists it, records it on the event, and pre-fills the form', async () => {
    h.characterId = OWNER.toString();
    const result = await updateMapSettingsAction({
      mapId: mapId.toString(),
      deleteExpiredConnections: true,
      deleteEolConnections: true,
      autoEolConnections: true,
      trackAbyssalJumps: false,
    });
    expect(result.ok).toBe(true);
    expect(await storedAutoEol()).toBe(true);
    expect(await lastMapUpdatePayload()).toMatchObject({ autoEolConnections: true });
    expect((await loadMapSettings(OWNER, mapId))!.autoEolConnections).toBe(true);
  });

  it('turning it off again is honored', async () => {
    h.characterId = OWNER.toString();
    const result = await updateMapSettingsAction({
      mapId: mapId.toString(),
      autoEolConnections: false,
    });
    expect(result.ok).toBe(true);
    expect(await storedAutoEol()).toBe(false);
    expect(await lastMapUpdatePayload()).toMatchObject({ autoEolConnections: false });
  });

  it('a character who cannot manage the map cannot turn it on', async () => {
    h.characterId = OUTSIDER.toString();
    const result = await updateMapSettingsAction({
      mapId: mapId.toString(),
      autoEolConnections: true,
    });
    expect(result.ok).toBe(false);
    expect(await storedAutoEol()).toBe(false);
  });
});
