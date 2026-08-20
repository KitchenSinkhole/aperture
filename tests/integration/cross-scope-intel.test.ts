// @vitest-environment node
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Session } from 'next-auth';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, pool } from '@/db/client';
import {
  apCharacter,
  apCharacterRole,
  apMap,
  apMapRoleAccess,
  apRole,
  apStructure,
  apStructureEvent,
  apUser,
  universeCategory,
  universeConstellation,
  universeGroup,
  universeRegion,
  universeSystem,
  universeType,
} from '@/db/schema';
import { requireMapView } from '@/app/api/map/utils';
import {
  intelScopeForMap,
  requireIntelTenant,
  requireStructureMutate,
  resolveIntelViewer,
  scopeAdmits,
  structureVisibleTo,
} from '@/lib/structures/guard';
import {
  createStructure,
  deleteStructure,
  updateStructure,
  type UpdateStructurePatch,
} from '@/lib/structures/mutations';
import { structuresForSystems } from '@/lib/structures/read';
import type { ApStructure } from '@/types';

/**
 * Regression guard for the P1 intel-scoping invariants on `ap_structure`
 * (Stages 4 and 5): a row is readable and mutable only by characters its
 * `scope` triple admits, a new row takes its scope from the map it is written
 * on, and the whole surface is closed on a map whose owning entity does not
 * include the caller.
 *
 * A static grep cannot guard this, for the same reason it could not guard the
 * Stage 1 tenancy asserts (see `cross-tenant-writes.test.ts`): the session gate
 * is present and correct on every structure route, and the defect it replaced
 * was a *missing second* check, not a missing first one. `ap_structure` carries
 * no `map_id` at all, so nothing in a route file's text distinguishes a scoped
 * read from a deployment-global one. The only reliable signal is the
 * behavioural attempt-and-reject against real Postgres: stand up two
 * organisations, have each try to read and mutate the other's rows, and confirm
 * both the refusal and that nothing was written.
 *
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test cross-scope-intel
 */
const run = process.env.RUN_DB_TESTS === '1';

// Universe fixtures: 98047xxx (98040xxx–98046xxx are claimed by other suites).
const REGION = 98047001;
const CONSTELLATION = 98047001;
const SYSTEM_ONE = 98047002;
const SYSTEM_TWO = 98047003;
/** Exists in the universe, sits on no map — for the "mapId is a scope selector" case. */
const SYSTEM_OFFMAP = 98047004;
const CATEGORY = 98047001;
const GROUP = 98047001;
const TYPE_ID = 98047001;
const FIXTURE_SYSTEMS = [SYSTEM_ONE, SYSTEM_TWO, SYSTEM_OFFMAP];

// Org / character fixtures: 99060xxx (99050xxx is claimed by permissions-scope).
const CORP_A = 99060001n;
const CORP_B = 99060002n;
const CORP_ADMIN = 99060003n;
const ALLIANCE_A = 99060011n;
const ALLIANCE_B = 99060012n;

const A_MEMBER = 99060101n;
/** A second org-A character: proves corp scope admits a non-creator. */
const A_PEER = 99060102n;
const B_MEMBER = 99060103n;
const ADMIN_ID = 99060104n;
/** Org-A affiliation but `status='kicked'` — a non-actor. */
const KICKED_ID = 99060105n;
/** Org B, holding a role grant on org A's map — a guest, not a tenant. */
const GUEST_ID = 99060106n;
/** Never inserted. */
const ABSENT_ID = 99060199n;

const CHARACTER_IDS = [A_MEMBER, A_PEER, B_MEMBER, ADMIN_ID, KICKED_ID, GUEST_ID];

let userId = 0;
let guestRoleId = 0n;
const GUEST_ROLE_NAME = 'Cross-Scope Guest Role';

let mapACorp = 0n;
let mapAAlliance = 0n;
let mapAPrivate = 0n;
let mapBCorp = 0n;
/** `type='corp'` with all three owner columns NULL — admin-visible, scope-less. */
let mapUnowned = 0n;
/** Owned by org A but soft-deleted. */
let mapDeleted = 0n;

let structACorp = 0n;
let structAAlliance = 0n;
let structAPrivate = 0n;
let structBCorp = 0n;
/** `scope='private'` with `scope_character_id` NULL — the erased-owner shape. */
let structOrphan = 0n;

function fixtureStructureIds(): bigint[] {
  return [structACorp, structAAlliance, structAPrivate, structBCorp, structOrphan];
}

describe.skipIf(!run)('cross-scope intel isolation — ap_structure (real Postgres)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    await cleanup();

    await db.insert(universeRegion).values({ id: REGION, name: 'Cross-Scope Test Region' });
    await db
      .insert(universeConstellation)
      .values({ id: CONSTELLATION, regionId: REGION, name: 'Cross-Scope Test Const' });
    await db.insert(universeSystem).values([
      { id: SYSTEM_ONE, constellationId: CONSTELLATION, name: 'J170001', security: 'C4' },
      { id: SYSTEM_TWO, constellationId: CONSTELLATION, name: 'J170002', security: 'C5' },
      { id: SYSTEM_OFFMAP, constellationId: CONSTELLATION, name: 'J170003', security: 'C5' },
    ]);
    await db.insert(universeCategory).values({ id: CATEGORY, name: 'Cross-Scope Cat' });
    await db
      .insert(universeGroup)
      .values({ id: GROUP, categoryId: CATEGORY, name: 'Cross-Scope Grp' });
    await db.insert(universeType).values({ id: TYPE_ID, groupId: GROUP, name: 'Cross-Scope Type' });

    const [u] = await db.insert(apUser).values({}).returning({ id: apUser.id });
    userId = u!.id;

    await db.insert(apCharacter).values([
      mkChar(A_MEMBER, 'Org A Member', { corporationId: CORP_A, allianceId: ALLIANCE_A }),
      mkChar(A_PEER, 'Org A Peer', { corporationId: CORP_A, allianceId: ALLIANCE_A }),
      mkChar(B_MEMBER, 'Org B Member', { corporationId: CORP_B, allianceId: ALLIANCE_B }),
      mkChar(ADMIN_ID, 'Instance Admin', { corporationId: CORP_ADMIN, authzLevel: 'admin' }),
      mkChar(KICKED_ID, 'Org A Kicked', {
        corporationId: CORP_A,
        allianceId: ALLIANCE_A,
        status: 'kicked',
      }),
      mkChar(GUEST_ID, 'Org B Guest', { corporationId: CORP_B, allianceId: ALLIANCE_B }),
    ]);

    const maps = await db
      .insert(apMap)
      .values([
        { name: 'Cross-Scope A Corp', scope: 'wh', type: 'corp', ownerCorporationId: CORP_A },
        {
          name: 'Cross-Scope A Alliance',
          scope: 'wh',
          type: 'alliance',
          ownerAllianceId: ALLIANCE_A,
        },
        {
          name: 'Cross-Scope A Private',
          scope: 'wh',
          type: 'private',
          ownerCharacterId: A_MEMBER,
        },
        { name: 'Cross-Scope B Corp', scope: 'wh', type: 'corp', ownerCorporationId: CORP_B },
        { name: 'Cross-Scope Unowned', scope: 'wh', type: 'corp' },
        {
          name: 'Cross-Scope Deleted',
          scope: 'wh',
          type: 'corp',
          ownerCorporationId: CORP_A,
          deletedAt: new Date(),
        },
      ])
      .returning({ id: apMap.id, name: apMap.name });
    const mapId = (name: string) => maps.find((m) => m.name === name)!.id;
    mapACorp = mapId('Cross-Scope A Corp');
    mapAAlliance = mapId('Cross-Scope A Alliance');
    mapAPrivate = mapId('Cross-Scope A Private');
    mapBCorp = mapId('Cross-Scope B Corp');
    mapUnowned = mapId('Cross-Scope Unowned');
    mapDeleted = mapId('Cross-Scope Deleted');

    // The guest's view access on org A's map: a role grant is the app's only
    // cross-organisation access path, so it is the shape the tenancy gate must
    // refuse intel to.
    const [role] = await db
      .insert(apRole)
      .values({ source: 'builtin', name: GUEST_ROLE_NAME })
      .returning({ id: apRole.id });
    guestRoleId = role!.id;
    await db.insert(apCharacterRole).values({ characterId: GUEST_ID, roleId: guestRoleId });
    await db
      .insert(apMapRoleAccess)
      .values({ mapId: mapACorp, roleId: guestRoleId, capability: 'view' });

    structACorp = (await seed(A_MEMBER, mapACorp, SYSTEM_ONE, 'A Corp Astrahus')).id;
    structAAlliance = (await seed(A_MEMBER, mapAAlliance, SYSTEM_ONE, 'A Alliance Fortizar')).id;
    structAPrivate = (await seed(A_MEMBER, mapAPrivate, SYSTEM_TWO, 'A Private Raitaru')).id;
    structBCorp = (await seed(B_MEMBER, mapBCorp, SYSTEM_ONE, 'B Corp Athanor')).id;

    // The erased-owner row: `scope_character_id` is ON DELETE SET NULL, so this
    // shape is produced by character erasure and is the only all-NULL shape the
    // Stage 3 CHECK admits. Inserted directly — no write path can create it.
    const [orphan] = await db
      .insert(apStructure)
      .values({
        systemId: SYSTEM_TWO,
        name: 'Orphaned Keepstar',
        structureTypeId: TYPE_ID,
        scope: 'private',
        scopeCharacterId: null,
      })
      .returning({ id: apStructure.id });
    structOrphan = orphan!.id;
  });

  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  // ─── intelScopeForMap — the scope a new row takes ─────────────────────────

  describe('intelScopeForMap', () => {
    it('derives the scope from the map, one populated column per branch', async () => {
      expect(await intelScopeForMap(mapACorp)).toEqual({
        scope: 'corp',
        scopeCharacterId: null,
        scopeCorporationId: CORP_A,
        scopeAllianceId: null,
      });
      expect(await intelScopeForMap(mapAAlliance)).toEqual({
        scope: 'alliance',
        scopeCharacterId: null,
        scopeCorporationId: null,
        scopeAllianceId: ALLIANCE_A,
      });
      expect(await intelScopeForMap(mapAPrivate)).toEqual({
        scope: 'private',
        scopeCharacterId: A_MEMBER,
        scopeCorporationId: null,
        scopeAllianceId: null,
      });
    });

    // An unowned map is exactly the shape that could otherwise fabricate a
    // scope: `canViewMap` lets an admin through it, so without this null the
    // create path would invent a tenancy no entity ever expressed.
    it('returns null for an unowned map, a soft-deleted map and a missing id', async () => {
      expect(await intelScopeForMap(mapUnowned)).toBeNull();
      expect(await intelScopeForMap(mapDeleted)).toBeNull();
      expect(await intelScopeForMap(999_999_999_999n)).toBeNull();
    });
  });

  // ─── create — the map is the scope selector ───────────────────────────────

  describe('create', () => {
    it('rejects a create naming a map the caller cannot view', async () => {
      const before = await structureCount(SYSTEM_ONE);
      const result = await createAsRoute(B_MEMBER, mapACorp, SYSTEM_ONE, 'B Injection');
      expect(result.status).toBe(404);
      expect(await structureCount(SYSTEM_ONE)).toBe(before);
    });

    it('rejects a create against an unowned or soft-deleted map even for an admin', async () => {
      const before = await structureCount(SYSTEM_ONE);
      // The admin clears `requireMapView` on both, so `intelScopeForMap`'s null
      // is the only thing standing between them and a fabricated scope.
      expect((await createAsRoute(ADMIN_ID, mapUnowned, SYSTEM_ONE, 'Unowned')).status).toBe(404);
      expect((await createAsRoute(ADMIN_ID, mapDeleted, SYSTEM_ONE, 'Deleted')).status).toBe(404);
      expect(await structureCount(SYSTEM_ONE)).toBe(before);
    });

    it('stamps the map-derived scope onto the row and its create event', async () => {
      const result = await createAsRoute(A_PEER, mapAAlliance, SYSTEM_ONE, 'A Peer Azbel');
      expect(result.status).toBe(200);
      const row = result.row!;
      expect(row.scope).toBe('alliance');
      expect(row.scopeAllianceId).toBe(ALLIANCE_A);
      expect(row.scopeCharacterId).toBeNull();
      expect(row.scopeCorporationId).toBeNull();

      const [event] = await db
        .select({
          kind: apStructureEvent.kind,
          scope: apStructureEvent.scope,
          scopeAllianceId: apStructureEvent.scopeAllianceId,
        })
        .from(apStructureEvent)
        .where(eq(apStructureEvent.structureId, row.id));
      expect(event).toMatchObject({ kind: 'create', scope: 'alliance', scopeAllianceId: ALLIANCE_A });

      await db.delete(apStructureEvent).where(eq(apStructureEvent.structureId, row.id));
      await db.delete(apStructure).where(eq(apStructure.id, row.id));
    });

    // ACCEPTED, not a defect: `mapId` on POST /api/structures is a scope
    // selector and nothing more — the route does not require the body's
    // `systemId` to be on that map. Structures are system-scoped by design (a
    // row surfaces on every map showing its system), and the scope the caller
    // stamps is one they could reach anyway by adding the system to their own
    // map first. So the reachable outcome is "write intel about an arbitrary
    // system into your own organisation's scope", which is not a cross-tenant
    // capability. Pinned here so a future change to this behaviour is a
    // deliberate one.
    it('accepts a systemId that is not on the scope-selector map', async () => {
      const result = await createAsRoute(A_MEMBER, mapACorp, SYSTEM_OFFMAP, 'Off-Map Sotiyo');
      expect(result.status).toBe(200);
      expect(result.row!.scope).toBe('corp');
      expect(result.row!.scopeCorporationId).toBe(CORP_A);

      await db.delete(apStructureEvent).where(eq(apStructureEvent.structureId, result.row!.id));
      await db.delete(apStructure).where(eq(apStructure.id, result.row!.id));
    });
  });

  // ─── requireStructureMutate — the row-scoped write gate ───────────────────

  describe('mutate gate', () => {
    it('admits a caller the row scope admits, across all three tiers', async () => {
      expect(await gate(A_MEMBER, structACorp)).toBe(200);
      expect(await gate(A_MEMBER, structAAlliance)).toBe(200);
      expect(await gate(A_MEMBER, structAPrivate)).toBe(200);
      // Vandalism inside a scope is deliberate: a corp mate who did not write
      // the row may still correct it.
      expect(await gate(A_PEER, structACorp)).toBe(200);
      expect(await gate(A_PEER, structAAlliance)).toBe(200);
    });

    it('404s a caller outside the row scope — never 403, which would confirm the id', async () => {
      expect(await gate(B_MEMBER, structACorp)).toBe(404);
      expect(await gate(B_MEMBER, structAAlliance)).toBe(404);
      expect(await gate(B_MEMBER, structAPrivate)).toBe(404);
      // A private row admits only its own character, not their corp mate.
      expect(await gate(A_PEER, structAPrivate)).toBe(404);
      // A missing row is indistinguishable from a forbidden one.
      expect(await gate(B_MEMBER, 999_999_999_999n)).toBe(404);
    });

    it('401s with no session, and 404s a missing or non-active character', async () => {
      expect((await requireStructureMutate(null, structACorp)).ok).toBe(false);
      expect(await gateSession(null, structACorp)).toBe(401);
      expect(await gate(KICKED_ID, structACorp)).toBe(404);
      expect(await gate(ABSENT_ID, structACorp)).toBe(404);
    });

    it('admits only an admin to the erased-owner row', async () => {
      expect(await gate(A_MEMBER, structOrphan)).toBe(404);
      expect(await gate(B_MEMBER, structOrphan)).toBe(404);
      expect(await gate(ADMIN_ID, structOrphan)).toBe(200);
    });
  });

  // ─── PATCH / DELETE — the refusal must also write nothing ─────────────────

  describe('cross-scope PATCH / DELETE', () => {
    it('a cross-scope PATCH 404s and leaves the row and its audit trail untouched', async () => {
      const before = await snapshotOf(structACorp);
      const beforeEvents = await eventCount(structACorp);

      const result = await patchAsRoute(B_MEMBER, structACorp, { name: 'Vandalised' });

      expect(result.status).toBe(404);
      expect(await snapshotOf(structACorp)).toEqual(before);
      expect(await eventCount(structACorp)).toBe(beforeEvents);
    });

    it('a cross-scope DELETE 404s and leaves the row in place', async () => {
      const beforeEvents = await eventCount(structAPrivate);

      const result = await deleteAsRoute(B_MEMBER, structAPrivate);

      expect(result.status).toBe(404);
      expect(await rowExists(structAPrivate)).toBe(true);
      expect(await eventCount(structAPrivate)).toBe(beforeEvents);
    });

    it('same-scope CRUD is unchanged: create, patch by a corp mate, then delete', async () => {
      const created = await createAsRoute(A_MEMBER, mapACorp, SYSTEM_TWO, 'A Corp Tatara');
      expect(created.status).toBe(200);
      const id = created.row!.id;

      const patched = await patchAsRoute(A_PEER, id, { name: 'A Corp Tatara (refit)' });
      expect(patched.status).toBe(200);
      expect(patched.row!.name).toBe('A Corp Tatara (refit)');

      const removed = await deleteAsRoute(A_PEER, id);
      expect(removed.status).toBe(200);
      expect(await rowExists(id)).toBe(false);
      // create + update + delete, all three stamped with the row's scope.
      expect(await eventCount(id)).toBe(3);
      const events = await db
        .select({ scope: apStructureEvent.scope, corp: apStructureEvent.scopeCorporationId })
        .from(apStructureEvent)
        .where(eq(apStructureEvent.structureId, id));
      for (const e of events) expect(e).toEqual({ scope: 'corp', corp: CORP_A });

      await db.delete(apStructureEvent).where(eq(apStructureEvent.structureId, id));
    });
  });

  // ─── structuresForSystems — the read filter ───────────────────────────────

  describe('read filter', () => {
    it('returns every row the viewer scope admits and nothing else', async () => {
      const asA = await structuresForSystems(mapACorp, [SYSTEM_ONE, SYSTEM_TWO], A_MEMBER);
      expect(idsIn(asA)).toEqual(
        new Set([structACorp, structAAlliance, structAPrivate].map(String)),
      );

      // A corp mate sees the corp and alliance rows but not the private one.
      const asPeer = await structuresForSystems(mapACorp, [SYSTEM_ONE, SYSTEM_TWO], A_PEER);
      expect(idsIn(asPeer)).toEqual(new Set([structACorp, structAAlliance].map(String)));

      const asB = await structuresForSystems(mapBCorp, [SYSTEM_ONE, SYSTEM_TWO], B_MEMBER);
      expect(idsIn(asB)).toEqual(new Set([structBCorp].map(String)));
    });

    it('surfaces the scope on the row so the UI can render it', async () => {
      const asA = await structuresForSystems(mapACorp, [SYSTEM_ONE], A_MEMBER);
      const corpRow = asA[SYSTEM_ONE]!.find((r) => r.id === structACorp.toString())!;
      expect(corpRow.scope).toBe('corp');
      expect(corpRow.scopeEntityId).toBe(Number(CORP_A));
    });

    it('hides the erased-owner row from everyone but an admin', async () => {
      const orphan = structOrphan.toString();
      expect(idsIn(await structuresForSystems(mapACorp, [SYSTEM_TWO], A_MEMBER)).has(orphan)).toBe(
        false,
      );
      expect(idsIn(await structuresForSystems(mapBCorp, [SYSTEM_TWO], B_MEMBER)).has(orphan)).toBe(
        false,
      );
      const asAdmin = idsIn(await structuresForSystems(mapACorp, [SYSTEM_ONE, SYSTEM_TWO], ADMIN_ID));
      for (const id of fixtureStructureIds()) expect(asAdmin.has(id.toString())).toBe(true);
    });

    it('reads nothing for a missing or non-active character', async () => {
      expect(await structuresForSystems(mapACorp, [SYSTEM_ONE, SYSTEM_TWO], KICKED_ID)).toEqual({});
      expect(await structuresForSystems(mapACorp, [SYSTEM_ONE, SYSTEM_TWO], ABSENT_ID)).toEqual({});
    });

    // The `system-data` route guards the map but not the requested system ids,
    // so a 256-id sweep is the cheapest way to walk the deployment's structure
    // log. The read filter is the only thing that closes it.
    it('a full 256-system-data sweep as org B returns none of org A rows', async () => {
      const sweep = [
        ...FIXTURE_SYSTEMS,
        ...Array.from({ length: 253 }, (_, i) => 30_000_000 + i),
      ];
      expect(sweep).toHaveLength(256);

      const seen = idsIn(await structuresForSystems(mapBCorp, sweep, B_MEMBER));
      expect(seen.has(structBCorp.toString())).toBe(true);
      for (const id of [structACorp, structAAlliance, structAPrivate, structOrphan]) {
        expect(seen.has(id.toString())).toBe(false);
      }
    });
  });

  // ─── guests — view access without tenancy ─────────────────────────────────

  // `ap_map_role_access` admits a character to a map from outside the entity
  // that owns it. Structure intel is not part of what that grant conveys: the
  // map's own rows are in a scope the guest is not in, and serving them their
  // own organisation's rows instead would overlay one corp's intel on another's
  // chain. So the whole surface is closed on that map, in both directions.
  describe('guest with a role grant on a map another organisation owns', () => {
    it('can view the map — the grant is real, and tenancy is the separate gate', async () => {
      const guard = await requireMapView(mapACorp.toString(), asSession(GUEST_ID));
      expect(guard.ok).toBe(true);
    });

    it('is refused by the tenancy gate on that map, and admitted on its own', async () => {
      const onHostMap = await requireIntelTenant(mapACorp, GUEST_ID);
      expect(onHostMap.ok).toBe(false);
      expect(onHostMap.ok === false && onHostMap.status).toBe(403);

      const onOwnMap = await requireIntelTenant(mapBCorp, GUEST_ID);
      expect(onOwnMap.ok).toBe(true);
      expect(onOwnMap.ok === true && onOwnMap.scope).toMatchObject({
        scope: 'corp',
        scopeCorporationId: CORP_B,
      });
    });

    it('reads no structures at all on the host map, not even its own corp rows', async () => {
      expect(await structuresForSystems(mapACorp, [SYSTEM_ONE, SYSTEM_TWO], GUEST_ID)).toEqual({});

      // The same rows are still there for them on a map their corp owns, so the
      // empty result above is the map gate and not a broken viewer.
      const onOwnMap = idsIn(await structuresForSystems(mapBCorp, [SYSTEM_ONE], GUEST_ID));
      expect(onOwnMap).toEqual(new Set([structBCorp.toString()]));
    });

    it('cannot create a row on the host map, and writes nothing trying', async () => {
      const before = await structureCount(SYSTEM_ONE);
      const result = await createAsRoute(GUEST_ID, mapACorp, SYSTEM_ONE, 'Guest Fortizar');
      expect(result.status).toBe(403);
      expect(await structureCount(SYSTEM_ONE)).toBe(before);
    });
  });

  // ─── the two forms of the admission rule must not drift ───────────────────

  // `scopeAdmits` (the row-at-a-time write gate) and `structureVisibleTo` (its
  // SQL form for the read side) live in the same module precisely because they
  // are one rule written twice. `scopeAdmits` deliberately carries NO admin
  // branch — both callers short-circuit on admin before reaching it — so the
  // agreement is asserted against the composed rule. Adding admin to
  // `scopeAdmits` to make a naive row-for-row comparison pass would silently
  // widen the write gate; that is the wrong repair for a failure here.
  it('scopeAdmits and structureVisibleTo admit the same rows for every viewer', async () => {
    const ids = fixtureStructureIds();
    const rows = await db
      .select({
        id: apStructure.id,
        scope: apStructure.scope,
        scopeCharacterId: apStructure.scopeCharacterId,
        scopeCorporationId: apStructure.scopeCorporationId,
        scopeAllianceId: apStructure.scopeAllianceId,
      })
      .from(apStructure)
      .where(inArray(apStructure.id, ids));
    expect(rows).toHaveLength(ids.length);

    for (const characterId of [A_MEMBER, A_PEER, B_MEMBER, ADMIN_ID]) {
      const viewer = await resolveIntelViewer(characterId);
      expect(viewer).not.toBeNull();

      const sqlAdmitted = new Set(
        (
          await db
            .select({ id: apStructure.id })
            .from(apStructure)
            .where(and(inArray(apStructure.id, ids), structureVisibleTo(viewer!)))
        ).map((r) => r.id.toString()),
      );
      const predicateAdmitted = new Set(
        rows
          .filter((r) => viewer!.isAdmin || scopeAdmits(r, viewer!))
          .map((r) => r.id.toString()),
      );

      expect(predicateAdmitted).toEqual(sqlAdmitted);
    }
  });
});

// PR #242 mirrors this file for `ap_system_note`: a second
// `describe.skipIf(!run)('cross-scope intel isolation — ap_system_note …')`
// block drops in below, with the same org fixtures plus the one assertion
// structures do not need — that a *capped* notes-browser page contains only
// admitted rows (the filter must run before the 50-row cap, not after).

// ─── route-shaped helpers ─────────────────────────────────────────────────────
// Each mirrors its route's guard-then-mutate order, so removing a guard makes
// the corresponding test fail on the status *and* on the row state.

async function createAsRoute(
  actor: bigint,
  mapId: bigint,
  systemId: number,
  name: string,
): Promise<{ status: number; row?: ApStructure }> {
  const guard = await requireMapView(mapId.toString(), asSession(actor));
  if (!guard.ok) return { status: guard.status };
  const tenant = await requireIntelTenant(guard.mapId, guard.characterId);
  if (!tenant.ok) return { status: tenant.status };
  if (!tenant.scope) return { status: 404 };
  const row = await createStructure({
    systemId,
    name,
    structureTypeId: TYPE_ID,
    characterId: guard.characterId,
    scope: tenant.scope,
  });
  return { status: 200, row };
}

async function patchAsRoute(
  actor: bigint,
  structureId: bigint,
  patch: UpdateStructurePatch,
): Promise<{ status: number; row?: ApStructure }> {
  const guard = await requireStructureMutate(asSession(actor), structureId);
  if (!guard.ok) return { status: guard.status };
  const row = await updateStructure({ structureId, patch, characterId: guard.characterId });
  return row ? { status: 200, row } : { status: 404 };
}

async function deleteAsRoute(
  actor: bigint,
  structureId: bigint,
): Promise<{ status: number; row?: ApStructure }> {
  const guard = await requireStructureMutate(asSession(actor), structureId);
  if (!guard.ok) return { status: guard.status };
  const row = await deleteStructure({ structureId, characterId: guard.characterId });
  return row ? { status: 200, row } : { status: 404 };
}

/** The mutate gate's HTTP status: 200 when admitted, otherwise its refusal code. */
function gate(actor: bigint, structureId: bigint): Promise<number> {
  return gateSession(asSession(actor), structureId);
}

async function gateSession(session: Session | null, structureId: bigint): Promise<number> {
  const guard = await requireStructureMutate(session, structureId);
  return guard.ok ? 200 : guard.status;
}

// ─── fixture + assertion helpers ──────────────────────────────────────────────

interface CharOverrides {
  authzLevel?: 'member' | 'admin';
  corporationId?: bigint;
  allianceId?: bigint;
  status?: 'active' | 'kicked' | 'banned';
}

function mkChar(id: bigint, name: string, overrides: CharOverrides = {}) {
  return {
    id,
    userId,
    name,
    ownerHash: `hash-${id.toString()}`,
    authzLevel: overrides.authzLevel ?? 'member',
    corporationId: overrides.corporationId ?? null,
    allianceId: overrides.allianceId ?? null,
    isDirector: false,
    status: overrides.status ?? 'active',
  } as const;
}

function asSession(characterId: bigint): Session {
  return { characterId: characterId.toString(), userId: 0 } as never;
}

async function seed(
  actor: bigint,
  mapId: bigint,
  systemId: number,
  name: string,
): Promise<ApStructure> {
  const result = await createAsRoute(actor, mapId, systemId, name);
  expect(result.status).toBe(200);
  return result.row!;
}

function idsIn(bySystem: Record<number, Array<{ id: string }>>): Set<string> {
  return new Set(Object.values(bySystem).flatMap((rows) => rows.map((r) => r.id)));
}

async function structureCount(systemId: number): Promise<number> {
  const rows = (
    await db.execute(
      sql`SELECT count(*)::int AS count FROM ap_structure WHERE system_id = ${systemId}`,
    )
  ).rows as Array<{ count: number }>;
  return rows[0]!.count;
}

async function eventCount(structureId: bigint): Promise<number> {
  const rows = (
    await db.execute(
      sql`SELECT count(*)::int AS count FROM ap_structure_event WHERE structure_id = ${structureId}`,
    )
  ).rows as Array<{ count: number }>;
  return rows[0]!.count;
}

async function snapshotOf(structureId: bigint) {
  const [row] = await db
    .select({
      name: apStructure.name,
      notes: apStructure.notes,
      scope: apStructure.scope,
      scopeCharacterId: apStructure.scopeCharacterId,
      scopeCorporationId: apStructure.scopeCorporationId,
      scopeAllianceId: apStructure.scopeAllianceId,
      updatedAt: apStructure.updatedAt,
    })
    .from(apStructure)
    .where(eq(apStructure.id, structureId));
  return row ?? null;
}

async function rowExists(structureId: bigint): Promise<boolean> {
  const [row] = await db
    .select({ id: apStructure.id })
    .from(apStructure)
    .where(eq(apStructure.id, structureId));
  return row !== undefined;
}

/**
 * The dev DB is not pristine, so every delete here is keyed on a fixture id this
 * suite owns. Structure rows carry no map id, so they are reclaimed through the
 * universe systems they were written against.
 */
async function cleanup() {
  await db
    .delete(apStructureEvent)
    .where(inArray(apStructureEvent.systemId, FIXTURE_SYSTEMS));
  await db.delete(apStructure).where(inArray(apStructure.systemId, FIXTURE_SYSTEMS));
  await db.delete(apMap).where(
    inArray(apMap.name, [
      'Cross-Scope A Corp',
      'Cross-Scope A Alliance',
      'Cross-Scope A Private',
      'Cross-Scope B Corp',
      'Cross-Scope Unowned',
      'Cross-Scope Deleted',
    ]),
  );
  // Cascades to `ap_character_role` and `ap_map_role_access`.
  await db.delete(apRole).where(eq(apRole.name, GUEST_ROLE_NAME));
  await db.delete(apCharacter).where(inArray(apCharacter.id, CHARACTER_IDS));
  if (userId) {
    await db.delete(apUser).where(eq(apUser.id, userId));
    userId = 0;
  }
  await db.delete(universeType).where(eq(universeType.id, TYPE_ID));
  await db.delete(universeGroup).where(eq(universeGroup.id, GROUP));
  await db.delete(universeCategory).where(eq(universeCategory.id, CATEGORY));
  await db.delete(universeSystem).where(inArray(universeSystem.id, FIXTURE_SYSTEMS));
  await db.delete(universeConstellation).where(eq(universeConstellation.id, CONSTELLATION));
  await db.delete(universeRegion).where(eq(universeRegion.id, REGION));

  guestRoleId = 0n;
  mapACorp = 0n;
  mapAAlliance = 0n;
  mapAPrivate = 0n;
  mapBCorp = 0n;
  mapUnowned = 0n;
  mapDeleted = 0n;
  structACorp = 0n;
  structAAlliance = 0n;
  structAPrivate = 0n;
  structBCorp = 0n;
  structOrphan = 0n;
}
