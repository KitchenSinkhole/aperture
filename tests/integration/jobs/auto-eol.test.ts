// @vitest-environment node
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { JobHelpers } from 'graphile-worker';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { db, pool } from '@/db/client';
import {
  apJobRun,
  apMap,
  apMapConnection,
  apMapEvent,
  apMapSignature,
  apMapSystem,
  apMapWebhook,
  universeCategory,
  universeConstellation,
  universeDogmaAttribute,
  universeGroup,
  universeRegion,
  universeSystem,
  universeSystemStatic,
  universeType,
  universeTypeAttribute,
  universeWormhole,
} from '@/db/schema';
import { autoEol } from '@/lib/jobs/tasks/autoEol';
import { mapEventPayloadSchema } from '@/lib/realtime/protocol';
import { runWebhookDispatch } from '@/lib/webhooks/dispatcher';
import { describeMapEvent } from '@/lib/webhooks/formatters';

/**
 * DB-gated like the rest:
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test
 *
 * The auto-EOL cron against its own two maps and `98171xxx` universe rows.
 */
const run = process.env.RUN_DB_TESTS === '1';
const FAKE_HELPERS = {} as unknown as JobHelpers;

const REGION = 98171001;
const CONSTELLATION = 98171001;
const SYS_A = 98171001; // C3, holds one H-bound static (the fallback source)
const SYS_B = 98171002; // C3
const SYS_H = 98171003; // H
const SYS_AMBIG = 98171004; // C3, holds two H-bound statics
const CATEGORY = 98171001;
const GROUP = 98171001;
const WH_O477 = 98171010; // 960 min
const WH_K162 = 98171011; // no lifetime
const WH_STATIC_H = 98171012; // 960 min, C3 → H
const WH_STATIC_H2 = 98171013; // 960 min, C3 → H
const FALLBACK_ATTR_ID = 98171001;
const LIFETIME_ATTR = 'wormholeMaxStableTime';

const HOUR = 3_600_000;

let optedMapId = 0n;
let plainMapId = 0n;
let attrId = 0;
let insertedAttr = false;
const ms: Record<string, bigint> = {};

const originalFetch = globalThis.fetch;

describe.skipIf(!run)('auto-eol cron (real Postgres)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    await cleanup();

    const [attr] = await db
      .select({ id: universeDogmaAttribute.id })
      .from(universeDogmaAttribute)
      .where(eq(universeDogmaAttribute.name, LIFETIME_ATTR))
      .limit(1);
    if (attr) {
      attrId = attr.id;
    } else {
      await db.insert(universeDogmaAttribute).values({ id: FALLBACK_ATTR_ID, name: LIFETIME_ATTR });
      attrId = FALLBACK_ATTR_ID;
      insertedAttr = true;
    }

    await db.insert(universeRegion).values({ id: REGION, name: 'Auto EOL Region' });
    await db
      .insert(universeConstellation)
      .values({ id: CONSTELLATION, regionId: REGION, name: 'Auto EOL Const' });
    await db.insert(universeSystem).values([
      { id: SYS_A, constellationId: CONSTELLATION, name: 'J171001', security: 'C3' },
      { id: SYS_B, constellationId: CONSTELLATION, name: 'J171002', security: 'C3' },
      { id: SYS_H, constellationId: CONSTELLATION, name: 'Autoeol Hisec', security: 'H' },
      { id: SYS_AMBIG, constellationId: CONSTELLATION, name: 'J171004', security: 'C3' },
    ]);
    await db.insert(universeCategory).values({ id: CATEGORY, name: 'Auto EOL Cat' });
    await db.insert(universeGroup).values({ id: GROUP, categoryId: CATEGORY, name: 'Auto EOL Grp' });
    await db.insert(universeType).values([
      { id: WH_O477, groupId: GROUP, name: 'Wormhole O477' },
      { id: WH_K162, groupId: GROUP, name: 'Wormhole K162' },
      { id: WH_STATIC_H, groupId: GROUP, name: 'Wormhole AE01' },
      { id: WH_STATIC_H2, groupId: GROUP, name: 'Wormhole AE02' },
    ]);
    await db.insert(universeWormhole).values([
      { typeId: WH_O477, name: 'O477', sourceClasses: ['C3'], targetClass: 'C3' },
      { typeId: WH_K162, name: 'K162', sourceClasses: null, targetClass: null },
      { typeId: WH_STATIC_H, name: 'AE01', sourceClasses: ['C3'], targetClass: 'H' },
      { typeId: WH_STATIC_H2, name: 'AE02', sourceClasses: ['C3'], targetClass: 'H' },
    ]);
    await db.insert(universeTypeAttribute).values([
      { typeId: WH_O477, attributeId: attrId, value: 960 },
      { typeId: WH_STATIC_H, attributeId: attrId, value: 960 },
      { typeId: WH_STATIC_H2, attributeId: attrId, value: 960 },
    ]);
    await db.insert(universeSystemStatic).values([
      { systemId: SYS_A, typeId: WH_STATIC_H },
      { systemId: SYS_AMBIG, typeId: WH_STATIC_H },
      { systemId: SYS_AMBIG, typeId: WH_STATIC_H2 },
    ]);

    const [opted] = await db
      .insert(apMap)
      .values({ name: 'Auto EOL Opted Map', scope: 'all', type: 'private', autoEolConnections: true })
      .returning({ id: apMap.id });
    optedMapId = opted!.id;
    const [plain] = await db
      .insert(apMap)
      .values({ name: 'Auto EOL Plain Map', scope: 'all', type: 'private' })
      .returning({ id: apMap.id });
    plainMapId = plain!.id;

    for (const [key, systemId] of [
      ['A', SYS_A],
      ['B', SYS_B],
      ['H', SYS_H],
      ['AMBIG', SYS_AMBIG],
    ] as const) {
      ms[key] = await addMapSystem(optedMapId, systemId);
    }
    ms.plainA = await addMapSystem(plainMapId, SYS_A);
    ms.plainB = await addMapSystem(plainMapId, SYS_B);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  it('marks only eligible holes (eol, auto), keeps them out of Discord, and audits them as estimates', async () => {
    // O477 (16h) is eligible from 12h of age.
    const typedDue = await hole(optedMapId, ms.A!, ms.B!, 13);
    await bindSig(ms.A!, 'AEA-001', typedDue, WH_O477);
    await bindSig(ms.B!, 'AEB-001', typedDue, WH_K162);
    const typedEarly = await hole(optedMapId, ms.A!, ms.B!, 11);
    await bindSig(ms.A!, 'AEA-002', typedEarly, WH_O477);
    const k162Only = await hole(optedMapId, ms.A!, ms.B!, 47);
    await bindSig(ms.B!, 'AEB-003', k162Only, WH_K162);
    const dormant = await hole(optedMapId, ms.A!, ms.B!, 13, { confirmedAt: null });
    await bindSig(ms.A!, 'AEA-004', dormant, WH_O477);
    const clearedByScout = await hole(optedMapId, ms.A!, ms.B!, 13, { eolSource: 'observed' });
    await bindSig(ms.A!, 'AEA-005', clearedByScout, WH_O477);
    const notOpted = await hole(plainMapId, ms.plainA!, ms.plainB!, 13);
    await bindSig(ms.plainA!, 'AEA-006', notOpted, WH_O477);
    // Untyped statics: A has one H-bound static, AMBIG has two.
    const staticDue = await hole(optedMapId, ms.A!, ms.H!, 13, { isStatic: true });
    const staticAmbiguous = await hole(optedMapId, ms.AMBIG!, ms.H!, 13, { isStatic: true });

    const before = await rows([typedDue, staticDue]);

    await autoEol.run(null, FAKE_HELPERS);

    const after = await rows([
      typedDue,
      typedEarly,
      k162Only,
      dormant,
      clearedByScout,
      notOpted,
      staticDue,
      staticAmbiguous,
    ]);
    for (const id of [typedDue, staticDue]) {
      const row = after.get(id)!;
      expect(row).toMatchObject({ eolStage: 'eol', eolSource: 'auto' });
      expect(Number(row.eolAgeSec)).toBeLessThan(60);
      // An estimate is not a sighting: `updated_at` (a `lastAliveAt` input) stays put.
      expect(row.updatedAt).toBe(before.get(id)!.updatedAt);
    }
    for (const id of [typedEarly, k162Only, dormant, notOpted, staticAmbiguous]) {
      expect(after.get(id)).toMatchObject({ eolStage: 'none', eolSource: null, eolAgeSec: null });
    }
    expect(after.get(clearedByScout)).toMatchObject({ eolStage: 'none', eolSource: 'observed' });

    const [runRow] = await db
      .select({ success: apJobRun.success, notes: apJobRun.notes })
      .from(apJobRun)
      .where(eq(apJobRun.name, 'auto-eol'))
      .orderBy(desc(apJobRun.startedAt))
      .limit(1);
    expect(runRow).toMatchObject({ success: true, notes: { marked: 2, failed: 0 } });

    const event = await updateEvent(typedDue);
    expect(event.characterId).toBeNull();
    expect(event.payload).toMatchObject({
      kind: 'connection.update',
      id: typedDue.toString(),
      source: ms.A!.toString(),
      target: ms.B!.toString(),
      eolStage: 'eol',
      eolSource: 'auto',
    });
    expect(
      Math.abs(Date.parse(event.payload.eolAt as string) - after.get(typedDue)!.eolAtMs!),
    ).toBeLessThan(1);

    const parsed = mapEventPayloadSchema.parse(event.payload);
    expect(
      describeMapEvent(parsed, {
        mapName: 'Auto EOL Opted Map',
        characterName: null,
        systemName: null,
        sourceSystemName: 'J171001',
        targetSystemName: 'J171002',
      }),
    ).toBe('updated **J171001** ↔ **J171002** (EOL estimated from age → ~4h)');

    await db.insert(apMapWebhook).values({
      mapId: optedMapId,
      channel: 'discord',
      event: 'history',
      url: 'https://discord.com/api/webhooks/1/AUTOEOL',
    });
    const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const notes = await runWebhookDispatch(optedMapId, event.id, event.occurredAt);
    expect(notes).toMatchObject({ attempted: 0, succeeded: 0, failed: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

async function addMapSystem(mapId: bigint, systemId: number): Promise<bigint> {
  const [row] = await db
    .insert(apMapSystem)
    .values({ mapId, systemId, visible: true })
    .returning({ id: apMapSystem.id });
  return row!.id;
}

async function hole(
  mapId: bigint,
  source: bigint,
  target: bigint,
  ageHours: number,
  extra: {
    confirmedAt?: null;
    eolSource?: 'observed';
    isStatic?: boolean;
  } = {},
): Promise<bigint> {
  const born = new Date(Date.now() - ageHours * HOUR);
  const [row] = await db
    .insert(apMapConnection)
    .values({
      mapId,
      sourceMapSystemId: source,
      targetMapSystemId: target,
      scope: 'wh',
      createdAt: born,
      updatedAt: born,
      confirmedAt: 'confirmedAt' in extra ? null : born,
      eolSource: extra.eolSource ?? null,
      isStatic: extra.isStatic ?? false,
    })
    .returning({ id: apMapConnection.id });
  return row!.id;
}

async function bindSig(mapSystemId: bigint, sigId: string, connectionId: bigint, typeId: number) {
  await db.insert(apMapSignature).values({
    mapSystemId,
    sigId,
    mapConnectionId: connectionId,
    groupKey: 'wormhole',
    typeId,
    expiresAt: new Date(Date.now() + 24 * HOUR),
  });
}

async function rows(ids: bigint[]) {
  const found = await db
    .select({
      id: apMapConnection.id,
      eolStage: apMapConnection.eolStage,
      eolSource: apMapConnection.eolSource,
      eolAgeSec: sql<string | null>`extract(epoch from now() - ${apMapConnection.eolAt})`,
      eolAtMs: sql<number | null>`(extract(epoch from ${apMapConnection.eolAt}) * 1000)::float8`,
      updatedAt: sql<string>`${apMapConnection.updatedAt}::text`,
    })
    .from(apMapConnection)
    .where(inArray(apMapConnection.id, ids));
  return new Map(found.map((r) => [r.id, r]));
}

async function updateEvent(connectionId: bigint) {
  const [row] = await db
    .select({
      id: apMapEvent.id,
      occurredAt: apMapEvent.occurredAt,
      characterId: apMapEvent.characterId,
      payload: apMapEvent.payload,
    })
    .from(apMapEvent)
    .where(
      and(
        eq(apMapEvent.mapId, optedMapId),
        eq(apMapEvent.kind, 'connection.update'),
        sql`${apMapEvent.payload}->>'id' = ${connectionId.toString()}`,
      ),
    );
  if (!row) throw new Error(`no connection.update for ${connectionId}`);
  return { ...row, payload: row.payload as Record<string, unknown> };
}

async function cleanup() {
  await db
    .delete(apMap)
    .where(inArray(apMap.name, ['Auto EOL Opted Map', 'Auto EOL Plain Map']));
  const typeIds = [WH_O477, WH_K162, WH_STATIC_H, WH_STATIC_H2];
  await db.delete(universeWormhole).where(inArray(universeWormhole.typeId, typeIds));
  await db.delete(universeType).where(inArray(universeType.id, typeIds));
  await db.delete(universeGroup).where(eq(universeGroup.id, GROUP));
  await db.delete(universeCategory).where(eq(universeCategory.id, CATEGORY));
  await db
    .delete(universeSystem)
    .where(inArray(universeSystem.id, [SYS_A, SYS_B, SYS_H, SYS_AMBIG]));
  await db.delete(universeConstellation).where(eq(universeConstellation.id, CONSTELLATION));
  await db.delete(universeRegion).where(eq(universeRegion.id, REGION));
  if (insertedAttr) {
    await db.delete(universeDogmaAttribute).where(eq(universeDogmaAttribute.id, FALLBACK_ATTR_ID));
  }
}
