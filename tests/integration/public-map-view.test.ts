// @vitest-environment node
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, pool } from '@/db/client';
import {
  apCharacter,
  apMap,
  apMapCharacterTracking,
  apMapConnection,
  apMapNote,
  apMapShare,
  apMapSignature,
  apMapSystem,
  apUser,
  universeConstellation,
  universeRegion,
  universeSystem,
} from '@/db/schema';
import { loadPublicMapView } from '@/lib/map/loadPublicMap';

/**
 * Public map share — redacted projection (Stage 2 of docs/plans/public-map-share.md).
 *
 * Verifies `loadPublicMapView` publishes only the redaction profile's
 * allowance and never leaks an intel note, a map note, an alias, lock state,
 * a rally point, attribution, or a pilot located off the visible map — for
 * every presence mode and per-token flag combination — while confirming the
 * chain-navigation `tag` and the k-space entrance list still come through.
 *
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test public-map-view
 */
const run = process.env.RUN_DB_TESTS === '1';

const REGION = 98040001;
const CONSTELLATION = 98040001;
const SYS_A = 98040001; // k-space "everything" system: alias, tag, lock, rally, intel notes
const SYS_B = 98040002; // j-space, wh scanned from both ends
const SYS_C = 98040003; // j-space, wh scanned from one end only
const SYS_D = 98040004; // k-space, stargate link
const SYS_HIDDEN = 98040005; // j-space, not visible — must not appear
const SYS_OFFMAP = 98040006; // k-space, on the universe but never added to the map

const PILOT_ID = 99740001n; // on-map, also the SYS_A lock holder
const OFFMAP_PILOT_ID = 99740002n;

const MAP_NAME = 'Public Share Redaction Map';
const ALIAS_SECRET = 'STAGING-DO-NOT-JUMP';
const INTEL_SECRET = 'TOP SECRET FLEET STAGING';
const NOTE_TITLE = 'Ambush plan';
const NOTE_BODY = 'Wait at the POS for the bait fleet';
const SIG_DESCRIPTION = 'Cloaky scout parked here';

let userId = 0;
let mapId = 0n;

describe.skipIf(!run)('Public map share — redacted projection (real Postgres)', () => {
  let sysAId = 0n;
  let sysBId = 0n;
  let sysCId = 0n;
  let sysDId = 0n;
  let sysHiddenId = 0n;
  let connAB = 0n; // wh, scanned both ends
  let connAC = 0n; // wh, scanned one end only
  let connAD = 0n; // stargate

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    await cleanup();

    await db.insert(universeRegion).values({ id: REGION, name: 'Public Share Test Region' });
    await db
      .insert(universeConstellation)
      .values({ id: CONSTELLATION, regionId: REGION, name: 'Public Share Test Const' });
    await db.insert(universeSystem).values([
      { id: SYS_A, constellationId: CONSTELLATION, name: 'PST A', security: 'H' },
      { id: SYS_B, constellationId: CONSTELLATION, name: 'PST B', security: 'C3' },
      { id: SYS_C, constellationId: CONSTELLATION, name: 'PST C', security: 'C3' },
      { id: SYS_D, constellationId: CONSTELLATION, name: 'PST D', security: 'H' },
      { id: SYS_HIDDEN, constellationId: CONSTELLATION, name: 'PST Hidden', security: 'C3' },
      { id: SYS_OFFMAP, constellationId: CONSTELLATION, name: 'PST Offmap', security: 'H' },
    ]);

    const [u] = await db.insert(apUser).values({}).returning({ id: apUser.id });
    userId = u!.id;
    await db.insert(apCharacter).values([
      {
        id: PILOT_ID,
        userId,
        name: 'Redaction Pilot',
        ownerHash: 'hash-pilot',
        lastSystemId: SYS_A,
        lastOnline: true,
        lastLocationAt: new Date(),
      },
      {
        id: OFFMAP_PILOT_ID,
        userId,
        name: 'Offmap Pilot',
        ownerHash: 'hash-offmap',
        lastSystemId: SYS_OFFMAP,
        lastOnline: true,
        lastLocationAt: new Date(),
      },
    ]);

    const [map] = await db
      .insert(apMap)
      .values({ name: MAP_NAME, scope: 'all', type: 'private', ownerCharacterId: PILOT_ID })
      .returning({ id: apMap.id });
    mapId = map!.id;

    await db.insert(apMapCharacterTracking).values([
      { mapId, characterId: PILOT_ID },
      { mapId, characterId: OFFMAP_PILOT_ID },
    ]);

    const systemRows = await db
      .insert(apMapSystem)
      .values([
        {
          mapId,
          systemId: SYS_A,
          visible: true,
          positionX: 0,
          positionY: 0,
          alias: ALIAS_SECRET,
          tag: 'A',
          intelNotes: INTEL_SECRET,
          locked: true,
          lockedByCharacterId: PILOT_ID,
          rallyAt: new Date(),
        },
        { mapId, systemId: SYS_B, visible: true, positionX: 100, positionY: 0, tag: 'B' },
        { mapId, systemId: SYS_C, visible: true, positionX: 200, positionY: 0, tag: 'C' },
        { mapId, systemId: SYS_D, visible: true, positionX: 300, positionY: 0, tag: 'D' },
        { mapId, systemId: SYS_HIDDEN, visible: false, positionX: 400, positionY: 0 },
      ])
      .returning({ id: apMapSystem.id, systemId: apMapSystem.systemId });
    sysAId = systemRows.find((r) => r.systemId === SYS_A)!.id;
    sysBId = systemRows.find((r) => r.systemId === SYS_B)!.id;
    sysCId = systemRows.find((r) => r.systemId === SYS_C)!.id;
    sysDId = systemRows.find((r) => r.systemId === SYS_D)!.id;
    sysHiddenId = systemRows.find((r) => r.systemId === SYS_HIDDEN)!.id;

    // SYS_B is Home, so SYS_A's two holes split: one leads to it, one doesn't.
    await db.update(apMap).set({ homeMapSystemId: sysBId }).where(eq(apMap.id, mapId));

    const connRows = await db
      .insert(apMapConnection)
      .values([
        {
          mapId,
          sourceMapSystemId: sysAId,
          targetMapSystemId: sysBId,
          scope: 'wh',
          massStatus: 'fresh',
          confirmedAt: new Date(),
        },
        {
          mapId,
          sourceMapSystemId: sysAId,
          targetMapSystemId: sysCId,
          scope: 'wh',
          massStatus: 'fresh',
          confirmedAt: new Date(),
        },
        {
          mapId,
          sourceMapSystemId: sysAId,
          targetMapSystemId: sysDId,
          scope: 'stargate',
          massStatus: 'fresh',
          confirmedAt: new Date(),
        },
        {
          mapId,
          sourceMapSystemId: sysAId,
          targetMapSystemId: sysHiddenId,
          scope: 'wh',
          massStatus: 'fresh',
          confirmedAt: new Date(),
        },
        {
          mapId,
          sourceMapSystemId: sysBId,
          targetMapSystemId: sysCId,
          scope: 'wh',
          massStatus: 'fresh',
          confirmedAt: null,
        },
      ])
      .returning({ id: apMapConnection.id, source: apMapConnection.sourceMapSystemId, target: apMapConnection.targetMapSystemId });
    connAB = connRows.find((c) => c.source === sysAId && c.target === sysBId)!.id;
    connAC = connRows.find((c) => c.source === sysAId && c.target === sysCId)!.id;
    connAD = connRows.find((c) => c.source === sysAId && c.target === sysDId)!.id;

    await db.insert(apMapSignature).values([
      {
        mapSystemId: sysAId,
        mapConnectionId: connAB,
        sigId: 'AAA',
        groupKey: 'wormhole',
        expiresAt: new Date(Date.now() + 86400000),
      },
      {
        mapSystemId: sysBId,
        mapConnectionId: connAB,
        sigId: 'BBB',
        groupKey: 'wormhole',
        expiresAt: new Date(Date.now() + 86400000),
      },
      // AC scanned from A's end only — C's end is unknown.
      {
        mapSystemId: sysAId,
        mapConnectionId: connAC,
        sigId: 'CCC',
        groupKey: 'wormhole',
        expiresAt: new Date(Date.now() + 86400000),
      },
      // An unattached cosmic sig with operator notes — must never appear.
      {
        mapSystemId: sysAId,
        sigId: 'DDD',
        groupKey: 'combat',
        classKind: 'signature',
        activityOverride: 'combat',
        description: SIG_DESCRIPTION,
        expiresAt: new Date(Date.now() + 86400000),
      },
    ]);

    await db.insert(apMapNote).values({
      mapId,
      title: NOTE_TITLE,
      content: NOTE_BODY,
      createdByCharacterId: PILOT_ID,
    });

    await db.insert(apMapShare).values([
      { mapId, token: 'pub-defaults', label: 'Defaults' },
      { mapId, token: 'pub-signatures', label: 'Signatures', showSignatures: true },
      { mapId, token: 'pub-sigids', label: 'Sig IDs', showConnectionSigIds: true },
      { mapId, token: 'pub-presence-none', label: 'No presence', presenceMode: 'none' },
      { mapId, token: 'pub-presence-full', label: 'Full presence', presenceMode: 'full' },
      { mapId, token: 'pub-revoked', label: 'Revoked', revokedAt: new Date() },
      {
        mapId,
        token: 'pub-expired',
        label: 'Expired',
        expiresAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    ]);
  });

  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  it('publishes the chain-navigation tag but redacts the operator alias', async () => {
    const data = await loadPublicMapView('pub-defaults');
    expect(data).not.toBeNull();
    const sysA = data!.systems.find((s) => s.systemId === SYS_A)!;
    expect(sysA.tag).toBe('A');
    expect((sysA as unknown as Record<string, unknown>).alias).toBeUndefined();
  });

  it('never leaks redacted content, for any token in the flag matrix', async () => {
    for (const token of [
      'pub-defaults',
      'pub-signatures',
      'pub-sigids',
      'pub-presence-none',
      'pub-presence-full',
    ]) {
      const data = await loadPublicMapView(token);
      expect(data).not.toBeNull();
      const json = JSON.stringify(data);
      expect(json).not.toContain(ALIAS_SECRET);
      expect(json).not.toContain(INTEL_SECRET);
      expect(json).not.toContain(NOTE_TITLE);
      expect(json).not.toContain(NOTE_BODY);
      expect(json).not.toContain(SIG_DESCRIPTION);

      const keys = new Set<string>();
      collectKeys(data, keys);
      for (const forbidden of [
        'alias',
        'intelNotes',
        'notes',
        'lockedByName',
        'lockedByCharacterId',
        'locked',
        'rallyAt',
        'description',
        'activityOverride',
        'userId',
        'mainCharacterId',
        'mainCharacterName',
      ]) {
        expect(keys.has(forbidden)).toBe(false);
      }

      if (token !== 'pub-presence-full') {
        expect(json).not.toContain('Redaction Pilot');
      }
      expect(json).not.toContain('Offmap Pilot');
    }
  });

  it('hides the invisible system and any connection touching it, and the dormant unconfirmed link', async () => {
    const data = await loadPublicMapView('pub-defaults');
    expect(data!.systems.some((s) => s.systemId === SYS_HIDDEN)).toBe(false);
    expect(data!.connections).toHaveLength(3); // AB, AC, AD — not AHidden, not the dormant BC
    expect(data!.connections.some((c) => c.source === sysHiddenId.toString() || c.target === sysHiddenId.toString())).toBe(false);
  });

  it('omits signatures when the flag is off, includes them (minus description/activityOverride) when on', async () => {
    const off = await loadPublicMapView('pub-defaults');
    expect(off!.signatures).toBeNull();

    const on = await loadPublicMapView('pub-signatures');
    expect(on!.signatures).not.toBeNull();
    const sigIds = on!.signatures!.map((s) => s.sigId).sort();
    expect(sigIds).toEqual(['AAA', 'BBB', 'CCC', 'DDD']);
  });

  it('publishes no endpoint sig codes when the flag is off', async () => {
    const data = await loadPublicMapView('pub-defaults');
    for (const c of data!.connections) expect(c.sigIds).toBeNull();
    expect(JSON.stringify(data)).not.toMatch(/AAA|BBB|CCC/);
  });

  it('publishes both endpoint codes for a two-sided hole, exactly one for a one-sided hole, and null for a stargate', async () => {
    const data = await loadPublicMapView('pub-sigids');
    const ab = data!.connections.find((c) => c.id === connAB.toString())!;
    expect(ab.sigIds).toEqual({ source: 'AAA', target: 'BBB' });

    const ac = data!.connections.find((c) => c.id === connAC.toString())!;
    expect(ac.sigIds).toEqual({ source: 'CCC', target: null });

    const ad = data!.connections.find((c) => c.id === connAD.toString())!;
    expect(ad.sigIds).toBeNull();
  });

  it('presence mode none omits the roster entirely', async () => {
    const data = await loadPublicMapView('pub-presence-none');
    expect(data!.presence).toEqual({ mode: 'none' });
  });

  it('presence mode anonymous (default) emits per-system counts with no names or ids, and excludes the off-map pilot', async () => {
    const data = await loadPublicMapView('pub-defaults');
    const presence = data!.presence;
    if (presence.mode !== 'anonymous') throw new Error(`expected anonymous, got ${presence.mode}`);
    expect(presence.systems).toEqual([{ systemId: SYS_A, count: 1, byClass: [] }]);
  });

  it('presence mode full carries names but no account linkage, and still excludes the off-map pilot', async () => {
    const data = await loadPublicMapView('pub-presence-full');
    const presence = data!.presence;
    if (presence.mode !== 'full') throw new Error(`expected full, got ${presence.mode}`);
    expect(presence.pilots).toHaveLength(1);
    expect(presence.pilots[0]).toMatchObject({
      characterId: Number(PILOT_ID),
      characterName: 'Redaction Pilot',
      systemId: SYS_A,
    });
  });

  it('lists one entrance per wormhole off a k-space system, and nothing for a gate-only one', async () => {
    const data = await loadPublicMapView('pub-defaults');
    // SYS_A (k-space) carries two wormholes into the chain. SYS_D is k-space too
    // but reaches the map only by stargate, and the hole to SYS_HIDDEN is gone
    // with its system.
    expect(data!.entrances).toHaveLength(2);
    for (const e of data!.entrances) {
      expect(e.mapSystemId).toBe(sysAId.toString());
      expect(e.systemId).toBe(SYS_A);
      expect(e.security).toBe('H');
      expect(e.leadsTo).toBe('C3');
      // The fixture systems aren't on the real stargate graph.
      expect(e.route).toBeNull();
    }
    expect(data!.entrances.map((e) => e.connectionId).sort()).toEqual(
      [connAB.toString(), connAC.toString()].sort(),
    );
  });

  it('marks the Home system and the one entrance that leads toward it', async () => {
    const data = await loadPublicMapView('pub-defaults');

    expect(data!.systems.filter((s) => s.isHome).map((s) => s.systemId)).toEqual([SYS_B]);

    // Both holes hang off the same k-space system, so the path has to come from
    // where each one comes out, not from the system the guest arrives in.
    const toHome = data!.entrances.find((e) => e.connectionId === connAB.toString())!;
    const away = data!.entrances.find((e) => e.connectionId === connAC.toString())!;
    expect(toHome.pathHome).toEqual([
      {
        connectionId: connAB.toString(),
        sigId: null,
        mapSystemId: sysBId.toString(),
        systemId: SYS_B,
        name: 'PST B',
        security: 'C3',
        tag: 'B',
      },
    ]);
    expect(away.pathHome).toBeNull();
  });

  it('withholds the entrance sig codes on the same flag that withholds the endpoint codes', async () => {
    const off = await loadPublicMapView('pub-defaults');
    for (const e of off!.entrances) {
      expect(e.sigId).toBeNull();
      expect(e.farSigId).toBeNull();
    }

    const on = await loadPublicMapView('pub-sigids');
    const ab = on!.entrances.find((e) => e.connectionId === connAB.toString())!;
    expect(ab).toMatchObject({ sigId: 'AAA', farSigId: 'BBB' });

    // Scanned from the k-space side only: the code to probe is known, the far
    // side is not, and the two states stay distinct.
    const ac = on!.entrances.find((e) => e.connectionId === connAC.toString())!;
    expect(ac).toMatchObject({ sigId: 'CCC', farSigId: null });
  });

  it('returns null for a revoked, expired, unknown, empty, or malformed token', async () => {
    expect(await loadPublicMapView('pub-revoked')).toBeNull();
    expect(await loadPublicMapView('pub-expired')).toBeNull();
    expect(await loadPublicMapView('pub-does-not-exist')).toBeNull();
    expect(await loadPublicMapView('')).toBeNull();
    expect(await loadPublicMapView('../../etc/passwd')).toBeNull();
  });
});

function collectKeys(value: unknown, keys: Set<string>): void {
  if (Array.isArray(value)) {
    for (const v of value) collectKeys(v, keys);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      keys.add(k);
      collectKeys(v, keys);
    }
  }
}

async function cleanup() {
  await db
    .delete(apMapShare)
    .where(
      inArray(apMapShare.token, [
        'pub-defaults',
        'pub-signatures',
        'pub-sigids',
        'pub-presence-none',
        'pub-presence-full',
        'pub-revoked',
        'pub-expired',
      ]),
    );
  if (mapId) await db.delete(apMap).where(eq(apMap.id, mapId));
  await db.delete(apMap).where(eq(apMap.name, MAP_NAME));
  await db
    .delete(apMapCharacterTracking)
    .where(inArray(apMapCharacterTracking.characterId, [PILOT_ID, OFFMAP_PILOT_ID]));
  await db.delete(apCharacter).where(inArray(apCharacter.id, [PILOT_ID, OFFMAP_PILOT_ID]));
  if (userId) {
    await db.delete(apUser).where(eq(apUser.id, userId));
    userId = 0;
  }
  await db
    .delete(universeSystem)
    .where(
      inArray(universeSystem.id, [SYS_A, SYS_B, SYS_C, SYS_D, SYS_HIDDEN, SYS_OFFMAP]),
    );
  await db.delete(universeConstellation).where(eq(universeConstellation.id, CONSTELLATION));
  await db.delete(universeRegion).where(eq(universeRegion.id, REGION));
  mapId = 0n;
}
