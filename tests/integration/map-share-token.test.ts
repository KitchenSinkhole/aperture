// @vitest-environment node
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, pool } from '@/db/client';
import { apCharacter, apMap, apMapShare, apUser } from '@/db/schema';
import { canMutateMap } from '@/lib/auth/rights';
import { resolveShareToken } from '@/lib/map/share';

/**
 * Public map share — token model (Stage 1 of docs/plans/public-map-share.md).
 *
 * Verifies `resolveShareToken`'s liveness predicate (live / expired / revoked
 * / soft-deleted-parent), that column defaults land as specified, the
 * `ap_map_share.map_id` CASCADE on map deletion, and the rights-layer lock-in
 * that `map_share` already routes through `canManageMap`.
 *
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test map-share-token
 */
const run = process.env.RUN_DB_TESTS === '1';

const CORP_ID = 99700001n;
const MANAGER_ID = 99701001n;
const VIEWER_ID = 99701002n;

const LIVE_MAP_NAME = 'Share Token Live Map';
const DELETED_MAP_NAME = 'Share Token Deleted-Parent Map';
const CASCADE_MAP_NAME = 'Share Token Cascade Map';

let userId = 0;
let liveMapId = 0n;
let deletedMapId = 0n;

describe.skipIf(!run)('Public map share — token model (real Postgres)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    await cleanup();

    const [u] = await db.insert(apUser).values({}).returning({ id: apUser.id });
    userId = u!.id;

    await db.insert(apCharacter).values([
      mkChar(MANAGER_ID, 'Share Manager', { isDirector: true }),
      mkChar(VIEWER_ID, 'Share Viewer', {}),
    ]);

    const inserted = await db
      .insert(apMap)
      .values([
        { name: LIVE_MAP_NAME, scope: 'all', type: 'corp', ownerCorporationId: CORP_ID },
        {
          name: DELETED_MAP_NAME,
          scope: 'all',
          type: 'corp',
          ownerCorporationId: CORP_ID,
          deletedAt: new Date(),
        },
      ])
      .returning({ id: apMap.id, name: apMap.name });
    liveMapId = inserted.find((m) => m.name === LIVE_MAP_NAME)!.id;
    deletedMapId = inserted.find((m) => m.name === DELETED_MAP_NAME)!.id;

    await db.insert(apMapShare).values([
      {
        mapId: liveMapId,
        token: 'tok-live',
        label: 'Live share',
        createdByCharacterId: MANAGER_ID,
      },
      {
        mapId: liveMapId,
        token: 'tok-expired',
        label: 'Expired share',
        expiresAt: new Date(Date.now() - 60 * 60 * 1000),
      },
      {
        mapId: liveMapId,
        token: 'tok-revoked',
        label: 'Revoked share',
        revokedAt: new Date(),
      },
      {
        mapId: deletedMapId,
        token: 'tok-deleted-parent',
        label: 'Orphaned by soft-delete',
      },
    ]);
  });

  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  it('resolves a live token to its map id, label, and profile', async () => {
    const resolved = await resolveShareToken('tok-live');
    expect(resolved).not.toBeNull();
    expect(resolved!.mapId).toBe(liveMapId);
    expect(resolved!.label).toBe('Live share');
  });

  it('column defaults land as specified', async () => {
    const resolved = await resolveShareToken('tok-live');
    expect(resolved!.profile).toEqual({
      presenceMode: 'anonymous',
      showSignatures: false,
      showConnectionSigIds: false,
    });
  });

  it('returns null for an expired token', async () => {
    expect(await resolveShareToken('tok-expired')).toBeNull();
  });

  it('returns null for a revoked token', async () => {
    expect(await resolveShareToken('tok-revoked')).toBeNull();
  });

  it('returns null when the parent map is soft-deleted, even though the share itself is live', async () => {
    expect(await resolveShareToken('tok-deleted-parent')).toBeNull();
  });

  it('returns null for an unknown, empty, or malformed token', async () => {
    expect(await resolveShareToken('tok-does-not-exist')).toBeNull();
    expect(await resolveShareToken('')).toBeNull();
    expect(await resolveShareToken('../../etc/passwd')).toBeNull();
  });

  it('cascades away when the parent map is hard-deleted', async () => {
    const [cascadeMap] = await db
      .insert(apMap)
      .values({ name: CASCADE_MAP_NAME, scope: 'all', type: 'corp', ownerCorporationId: CORP_ID })
      .returning({ id: apMap.id });
    const cascadeMapId = cascadeMap!.id;
    await db.insert(apMapShare).values({
      mapId: cascadeMapId,
      token: 'tok-cascade',
      label: 'Cascade share',
    });

    await db.delete(apMap).where(eq(apMap.id, cascadeMapId));

    const remaining = await db
      .select({ id: apMapShare.id })
      .from(apMapShare)
      .where(eq(apMapShare.mapId, cascadeMapId));
    expect(remaining).toEqual([]);
    expect(await resolveShareToken('tok-cascade')).toBeNull();
  });

  it('map_share already routes through canManageMap: a corp Director manages, a plain member does not', async () => {
    expect(await canMutateMap(MANAGER_ID, liveMapId, 'map_share')).toBe(true);
    expect(await canMutateMap(VIEWER_ID, liveMapId, 'map_share')).toBe(false);
  });
});

function mkChar(id: bigint, name: string, overrides: { isDirector?: boolean }) {
  return {
    id,
    userId,
    name,
    ownerHash: `hash-${id.toString()}`,
    corporationId: CORP_ID,
    isDirector: overrides.isDirector ?? false,
  } as const;
}

async function cleanup() {
  await db
    .delete(apMapShare)
    .where(
      sql`token IN ('tok-live', 'tok-expired', 'tok-revoked', 'tok-deleted-parent', 'tok-cascade')`,
    );
  await db
    .delete(apMap)
    .where(sql`name IN (${LIVE_MAP_NAME}, ${DELETED_MAP_NAME}, ${CASCADE_MAP_NAME})`);
  await db.delete(apCharacter).where(inArray(apCharacter.id, [MANAGER_ID, VIEWER_ID]));
  if (userId) {
    await db.delete(apUser).where(eq(apUser.id, userId));
    userId = 0;
  }
  liveMapId = 0n;
  deletedMapId = 0n;
}
