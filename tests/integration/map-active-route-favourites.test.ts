// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { and, eq, inArray } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';
import { db, pool } from '@/db/client';
import {
  apCharacter,
  apMap,
  apMapActiveRoute,
  apMapRouteFavourite,
  apUser,
  universeConstellation,
  universeRegion,
  universeSystem,
} from '@/db/schema';

/**
 * Active route, route favourites, and route-shortcut permissions (real Postgres).
 *
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test map-active-route-favourites
 */
const run = process.env.RUN_DB_TESTS === '1';

const h = vi.hoisted(() => ({ characterId: '0', userId: 0 }));
let currentSession: Session | null = null;

vi.mock('@/lib/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/session')>();
  return {
    ...actual,
    requireSession: async () => ({
      characterId: h.characterId,
      userId: h.userId,
    }),
    getSession: vi.fn(async () => currentSession),
  };
});
vi.mock('@/lib/auth', () => ({
  auth: vi.fn(async () => currentSession),
}));

const { setMapActiveRouteAction, clearMapActiveRouteAction } = await import(
  '@/app/(app)/actions/mapActiveRoute'
);
const { addMapRouteFavouriteAction, removeMapRouteFavouriteAction } = await import(
  '@/app/(app)/actions/mapRouteFavourites'
);
const { GET: routeShortcutGet } = await import('@/app/api/map/[mapId]/route-shortcut/route');
const { resolveRouteShortcut } = await import('@/lib/map/routeShortcuts');

const REGION = 98125001;
const CONSTELLATION = 98125001;
const SYS_DEST = 98125001;
const SYS_OTHER = 98125002;

const OWNER_CHAR = 98125001n;
const OWNER_ALT = 98125002n;
const OUTSIDER_CHAR = 98125003n;
const characterIds = [OWNER_CHAR, OWNER_ALT, OUTSIDER_CHAR];

let ownerUserId = 0;
let outsiderUserId = 0;
let mapId = 0n;
let otherMapId = 0n;

function actAs(characterId: bigint, userId: number): void {
  h.characterId = characterId.toString();
  h.userId = userId;
  currentSession = {
    characterId: characterId.toString(),
    userId,
    user: { id: String(userId) },
  } as unknown as Session;
}

function mkPlan(destId: number, destName: string) {
  return {
    destinationSystemId: destId,
    destinationName: destName,
    reachable: true,
    jumps: 1,
    hops: [
      {
        systemId: destId,
        name: destName,
        security: '0.5',
        securityStatus: 0.5,
        via: 'origin' as const,
        connectionId: null,
        onMap: true,
        tag: null,
        viaSigId: null,
      },
    ],
  };
}

async function cleanup(): Promise<void> {
  if (mapId) {
    await db.delete(apMapActiveRoute).where(eq(apMapActiveRoute.mapId, mapId));
    await db.delete(apMapRouteFavourite).where(eq(apMapRouteFavourite.mapId, mapId));
  }
  if (otherMapId) {
    await db.delete(apMapRouteFavourite).where(eq(apMapRouteFavourite.mapId, otherMapId));
  }
  const mapIds = [mapId, otherMapId].filter((id) => id > 0n);
  if (mapIds.length) await db.delete(apMap).where(inArray(apMap.id, mapIds));
  await db.delete(apCharacter).where(inArray(apCharacter.id, characterIds));
  await db.delete(universeSystem).where(inArray(universeSystem.id, [SYS_DEST, SYS_OTHER]));
  await db.delete(universeConstellation).where(eq(universeConstellation.id, CONSTELLATION));
  await db.delete(universeRegion).where(eq(universeRegion.id, REGION));
  if (ownerUserId) await db.delete(apUser).where(eq(apUser.id, ownerUserId));
  if (outsiderUserId) await db.delete(apUser).where(eq(apUser.id, outsiderUserId));
}

describe.skipIf(!run)('map active route & favourites (real Postgres)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    await cleanup();

    await db.insert(universeRegion).values({ id: REGION, name: 'Route Actions Region' });
    await db
      .insert(universeConstellation)
      .values({ id: CONSTELLATION, regionId: REGION, name: 'Route Actions Const' });
    await db.insert(universeSystem).values([
      { id: SYS_DEST, constellationId: CONSTELLATION, name: 'Route Dest', security: '0.5' },
      { id: SYS_OTHER, constellationId: CONSTELLATION, name: 'Route Other', security: '0.2' },
    ]);

    const [ownerUser] = await db.insert(apUser).values({}).returning({ id: apUser.id });
    const [outsiderUser] = await db.insert(apUser).values({}).returning({ id: apUser.id });
    ownerUserId = ownerUser!.id;
    outsiderUserId = outsiderUser!.id;

    await db.insert(apCharacter).values([
      {
        id: OWNER_CHAR,
        userId: ownerUserId,
        name: 'Route Owner',
        ownerHash: 'route-owner',
        status: 'active',
      },
      {
        id: OWNER_ALT,
        userId: ownerUserId,
        name: 'Route Owner Alt',
        ownerHash: 'route-owner-alt',
        status: 'active',
      },
      {
        id: OUTSIDER_CHAR,
        userId: outsiderUserId,
        name: 'Route Outsider',
        ownerHash: 'route-outsider',
        status: 'active',
      },
    ]);

    const [map] = await db
      .insert(apMap)
      .values({
        name: 'Route Actions Map',
        scope: 'all',
        type: 'private',
        ownerCharacterId: OWNER_CHAR,
      })
      .returning({ id: apMap.id });
    mapId = map!.id;
    const [other] = await db
      .insert(apMap)
      .values({
        name: 'Route Actions Other',
        scope: 'all',
        type: 'private',
        ownerCharacterId: OUTSIDER_CHAR,
      })
      .returning({ id: apMap.id });
    otherMapId = other!.id;
  });

  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  it('setMapActiveRouteAction stores a route for owned characters', async () => {
    actAs(OWNER_CHAR, ownerUserId);
    const result = await setMapActiveRouteAction({
      mapId: mapId.toString(),
      primaryCharacterId: Number(OWNER_CHAR),
      destinationSystemId: SYS_DEST,
      plan: mkPlan(SYS_DEST, 'Route Dest'),
      followerCharacterIds: [Number(OWNER_CHAR), Number(OWNER_ALT)],
    });
    expect(result.ok).toBe(true);
    const rows = await db
      .select()
      .from(apMapActiveRoute)
      .where(and(eq(apMapActiveRoute.mapId, mapId), eq(apMapActiveRoute.ownerUserId, ownerUserId)));
    expect(rows).toHaveLength(1);
  });

  it('setMapActiveRouteAction rejects a follower from another account', async () => {
    actAs(OWNER_CHAR, ownerUserId);
    const result = await setMapActiveRouteAction({
      mapId: mapId.toString(),
      primaryCharacterId: Number(OWNER_CHAR),
      destinationSystemId: SYS_DEST,
      plan: mkPlan(SYS_DEST, 'Route Dest'),
      followerCharacterIds: [Number(OWNER_CHAR), Number(OUTSIDER_CHAR)],
    });
    expect(result).toEqual({ ok: false, error: 'Character not found.' });
  });

  it('clearMapActiveRouteAction removes only the acting user row', async () => {
    actAs(OWNER_CHAR, ownerUserId);
    expect((await clearMapActiveRouteAction({ mapId: mapId.toString() })).ok).toBe(true);
    const rows = await db.select().from(apMapActiveRoute).where(eq(apMapActiveRoute.mapId, mapId));
    expect(rows).toHaveLength(0);
  });

  it('setMapActiveRouteAction rejects another user without map access', async () => {
    actAs(OUTSIDER_CHAR, outsiderUserId);
    const result = await setMapActiveRouteAction({
      mapId: mapId.toString(),
      primaryCharacterId: Number(OUTSIDER_CHAR),
      destinationSystemId: SYS_DEST,
      plan: mkPlan(SYS_DEST, 'Route Dest'),
      followerCharacterIds: [Number(OUTSIDER_CHAR)],
    });
    expect(result).toEqual({ ok: false, error: 'No access.' });
  });

  it('addMapRouteFavouriteAction persists shared flag and upserts', async () => {
    actAs(OWNER_CHAR, ownerUserId);
    const added = await addMapRouteFavouriteAction({
      mapId: mapId.toString(),
      systemId: SYS_DEST,
      label: 'Home',
      shared: true,
    });
    expect(added.ok).toBe(true);
    const [row] = await db
      .select()
      .from(apMapRouteFavourite)
      .where(
        and(
          eq(apMapRouteFavourite.mapId, mapId),
          eq(apMapRouteFavourite.userId, ownerUserId),
          eq(apMapRouteFavourite.systemId, SYS_DEST),
        ),
      );
    expect(row?.shared).toBe(true);
    expect(row?.label).toBe('Home');

    const updated = await addMapRouteFavouriteAction({
      mapId: mapId.toString(),
      systemId: SYS_DEST,
      label: 'Staging',
      shared: false,
    });
    expect(updated.ok).toBe(true);
    const [row2] = await db
      .select()
      .from(apMapRouteFavourite)
      .where(eq(apMapRouteFavourite.id, row!.id));
    expect(row2?.label).toBe('Staging');
    expect(row2?.shared).toBe(false);
  });

  it('removeMapRouteFavouriteAction scopes delete to mapId', async () => {
    actAs(OWNER_CHAR, ownerUserId);
    const [row] = await db
      .select()
      .from(apMapRouteFavourite)
      .where(eq(apMapRouteFavourite.mapId, mapId));
    expect(row).toBeDefined();

    await removeMapRouteFavouriteAction({
      mapId: otherMapId.toString(),
      favouriteId: row!.id.toString(),
    });
    const still = await db
      .select()
      .from(apMapRouteFavourite)
      .where(eq(apMapRouteFavourite.id, row!.id));
    expect(still).toHaveLength(1);

    await removeMapRouteFavouriteAction({
      mapId: mapId.toString(),
      favouriteId: row!.id.toString(),
    });
    const gone = await db
      .select()
      .from(apMapRouteFavourite)
      .where(eq(apMapRouteFavourite.id, row!.id));
    expect(gone).toHaveLength(0);
  });

  it('removeMapRouteFavouriteAction requires map view', async () => {
    actAs(OWNER_CHAR, ownerUserId);
    const pin = await addMapRouteFavouriteAction({
      mapId: mapId.toString(),
      systemId: SYS_OTHER,
    });
    expect(pin.ok).toBe(true);

    actAs(OUTSIDER_CHAR, outsiderUserId);
    const denied = await removeMapRouteFavouriteAction({
      mapId: mapId.toString(),
      favouriteId: (pin as { ok: true; data: { id: string } }).data.id,
    });
    expect(denied).toEqual({ ok: false, error: 'No access.' });
  });

  it('route-shortcut GET allows map viewers and returns not-found for outsiders', async () => {
    actAs(OWNER_CHAR, ownerUserId);
    const allowed = await routeShortcutGet(
      new NextRequest(
        `http://localhost/api/map/${mapId}/route-shortcut?from=${SYS_DEST}&kind=nearest_highsec`,
      ),
      { params: Promise.resolve({ mapId: mapId.toString() }) },
    );
    expect(allowed.status).toBe(200);

    actAs(OUTSIDER_CHAR, outsiderUserId);
    const denied = await routeShortcutGet(
      new NextRequest(
        `http://localhost/api/map/${mapId}/route-shortcut?from=${SYS_DEST}&kind=nearest_highsec`,
      ),
      { params: Promise.resolve({ mapId: mapId.toString() }) },
    );
    expect(denied.status).toBe(404);
  });

  it('resolveRouteShortcut runs for a known system id', async () => {
    const result = await resolveRouteShortcut('nearest_highsec', SYS_DEST);
    expect(result === null || typeof result === 'number').toBe(true);
  });
});