// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, inArray, sql } from 'drizzle-orm';
import { db, pool } from '@/db/client';
import {
  apAlliance,
  apCharacter,
  apCharacterRole,
  apCorporation,
  apMap,
  apMapRoleAccess,
  apRole,
  apUser,
} from '@/db/schema';
import {
  canCreateMap,
  canManageMap,
  canMutateMap,
  canUseMapFeature,
  canViewMap,
  hasMapCapability,
  isAdmin,
  requireMapCapability,
  resolveMapCapabilities,
} from '@/lib/auth/rights';
import type { MapCapability } from '@/types';
import { listViewableMaps } from '@/lib/map/loadMap';
import { characterCleanup } from '@/lib/jobs/tasks/characterCleanup';

/**
 * Permissions acceptance gate.
 *
 * Drives the rights model end-to-end against real Postgres:
 *   - Owner-by-scope (private/corp/alliance) view truth table.
 *   - Derived-authority mutate: private owner, owning-corp Director, and the
 *     owning-alliance's executor-corp Director manage; plain members cannot.
 *   - Role overlay grants view only (no mutation by themselves).
 *   - `canCreateMap(type)` derives from EVE state (private→any, corp/alliance→Director).
 *   - Admin sees and manages every map.
 *   - Kicked / banned characters fail every check.
 *   - `listViewableMaps` SQL filter matches the per-check results.
 *   - `character-cleanup` cron clears expired kicks.
 *
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test
 */
const run = process.env.RUN_DB_TESTS === '1';

const CORP_A = 99000001n;
const CORP_B = 99000002n;
const ALLIANCE_X = 99000901n;
const ALLIANCE_Y = 99000902n;

const ADMIN_ID = 99001001n;
const OWNER_ID = 99001002n;
const CORP_A_MEMBER_ID = 99001003n;
const CORP_A_DIRECTOR_ID = 99001004n;
const CORP_B_MEMBER_ID = 99001005n;
const ALLIANCE_X_PILOT_ID = 99001006n;
const KICKED_ID = 99001007n;
const ROLE_HOLDER_ID = 99001008n;

const CORP_TITLE_ROLE_ID = 99002001n;

let userId = 0;
let privateMapId = 0n;
let corpMapId = 0n;
let allianceMapId = 0n;
let roleScopedMapId = 0n;

const characterIds = [
  ADMIN_ID,
  OWNER_ID,
  CORP_A_MEMBER_ID,
  CORP_A_DIRECTOR_ID,
  CORP_B_MEMBER_ID,
  ALLIANCE_X_PILOT_ID,
  KICKED_ID,
  ROLE_HOLDER_ID,
];

describe.skipIf(!run)('Stage 15 — permissions (real Postgres)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    await cleanup();

    const [u] = await db.insert(apUser).values({}).returning({ id: apUser.id });
    userId = u!.id;

    // Two corps, two alliances. Corp A is in Alliance X and is its executor.
    await db.insert(apCorporation).values([
      { id: CORP_A, name: 'Test Corp A', allianceId: ALLIANCE_X },
      { id: CORP_B, name: 'Test Corp B', allianceId: ALLIANCE_Y },
    ]);
    await db.insert(apAlliance).values([
      { id: ALLIANCE_X, name: 'Alliance X', executorCorporationId: CORP_A },
      { id: ALLIANCE_Y, name: 'Alliance Y', executorCorporationId: CORP_B },
    ]);

    // Characters covering every permission lane. CORP_A_DIRECTOR_ID is a
    // Director of Corp A (the executor of Alliance X) → manages corp + alliance
    // maps under derived authority.
    await db.insert(apCharacter).values([
      mkChar(ADMIN_ID, 'Director Admin', { authzLevel: 'admin', corporationId: CORP_A, allianceId: ALLIANCE_X }),
      mkChar(OWNER_ID, 'Map Owner', { corporationId: CORP_A, allianceId: ALLIANCE_X }),
      mkChar(CORP_A_MEMBER_ID, 'Corp A Member', { corporationId: CORP_A, allianceId: ALLIANCE_X }),
      mkChar(CORP_A_DIRECTOR_ID, 'Corp A Director', {
        corporationId: CORP_A,
        allianceId: ALLIANCE_X,
        isDirector: true,
      }),
      mkChar(CORP_B_MEMBER_ID, 'Corp B Outsider', { corporationId: CORP_B, allianceId: ALLIANCE_Y }),
      mkChar(ALLIANCE_X_PILOT_ID, 'Alliance X Pilot', { corporationId: CORP_B, allianceId: ALLIANCE_X }),
      mkChar(KICKED_ID, 'Kicked Pilot', {
        corporationId: CORP_A,
        allianceId: ALLIANCE_X,
        status: 'kicked',
        statusExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      }),
      mkChar(ROLE_HOLDER_ID, 'Role Holder', { corporationId: CORP_B, allianceId: ALLIANCE_Y }),
    ]);

    // A role used to grant cross-corp view access to one specific map.
    await db.insert(apRole).values({
      id: CORP_TITLE_ROLE_ID,
      source: 'corp_title',
      externalRef: `${CORP_B.toString()}:42`,
      name: 'Logistics',
      corporationId: CORP_B,
    });
    await db.insert(apCharacterRole).values({
      characterId: ROLE_HOLDER_ID,
      roleId: CORP_TITLE_ROLE_ID,
      grantedBy: 'corp-title-sync',
    });

    // The four maps under test.
    const inserted = await db
      .insert(apMap)
      .values([
        {
          name: 'Owner Private',
          scope: 'wh',
          type: 'private',
          ownerCharacterId: OWNER_ID,
        },
        {
          name: 'Corp A Map',
          scope: 'all',
          type: 'corp',
          ownerCorporationId: CORP_A,
        },
        {
          name: 'Alliance X Map',
          scope: 'all',
          type: 'alliance',
          ownerAllianceId: ALLIANCE_X,
        },
        {
          name: 'Role-Scoped Map',
          scope: 'all',
          type: 'private',
          ownerCharacterId: OWNER_ID,
        },
      ])
      .returning({ id: apMap.id, name: apMap.name });

    privateMapId = inserted.find((m) => m.name === 'Owner Private')!.id;
    corpMapId = inserted.find((m) => m.name === 'Corp A Map')!.id;
    allianceMapId = inserted.find((m) => m.name === 'Alliance X Map')!.id;
    roleScopedMapId = inserted.find((m) => m.name === 'Role-Scoped Map')!.id;

    // The role-scoped map grants access to the `corp_title` Logistics role.
    await db.insert(apMapRoleAccess).values({
      mapId: roleScopedMapId,
      roleId: CORP_TITLE_ROLE_ID,
      capability: 'view',
    });

    // Per-title feature delegation (R4): the same `corp_title` role is granted
    // the `audit_view` capability on the corp map — the holder can read that
    // map's audit log without being a Director.
    await db.insert(apMapRoleAccess).values({
      mapId: corpMapId,
      roleId: CORP_TITLE_ROLE_ID,
      capability: 'audit_view',
    });
  });

  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  // ─── view rules ──────────────────────────────────────────────────────────

  it('owner can view their private map; nobody else can', async () => {
    expect(await canViewMap(OWNER_ID, privateMapId)).toBe(true);
    expect(await canViewMap(CORP_A_MEMBER_ID, privateMapId)).toBe(false);
    expect(await canViewMap(CORP_B_MEMBER_ID, privateMapId)).toBe(false);
    expect(await canViewMap(ADMIN_ID, privateMapId)).toBe(true);
  });

  it('corp members view the corp map; outsiders cannot', async () => {
    expect(await canViewMap(OWNER_ID, corpMapId)).toBe(true); // in corp A
    expect(await canViewMap(CORP_A_MEMBER_ID, corpMapId)).toBe(true);
    expect(await canViewMap(CORP_B_MEMBER_ID, corpMapId)).toBe(false);
    expect(await canViewMap(ALLIANCE_X_PILOT_ID, corpMapId)).toBe(false);
  });

  it('alliance members view the alliance map regardless of corp', async () => {
    // Corp A is in Alliance X → its members see the alliance map.
    expect(await canViewMap(OWNER_ID, allianceMapId)).toBe(true);
    // Corp B is in Alliance Y → its members do NOT see Alliance X's map.
    expect(await canViewMap(CORP_B_MEMBER_ID, allianceMapId)).toBe(false);
    // Alliance X Pilot is in Corp B but Alliance X (configured deliberately) → sees it.
    expect(await canViewMap(ALLIANCE_X_PILOT_ID, allianceMapId)).toBe(true);
  });

  it('role overlay grants view to a holder outside the owner scope', async () => {
    // Role holder is in Corp B / Alliance Y — would be denied by the owner rule.
    // The `ap_map_role_access` row routes view access via their `corp_title` role.
    expect(await canViewMap(ROLE_HOLDER_ID, roleScopedMapId)).toBe(true);
    // Owner still sees their own map.
    expect(await canViewMap(OWNER_ID, roleScopedMapId)).toBe(true);
    // Random corp member without the role does not.
    expect(await canViewMap(CORP_A_MEMBER_ID, roleScopedMapId)).toBe(false);
  });

  it('kicked characters fail every view check', async () => {
    expect(await canViewMap(KICKED_ID, privateMapId)).toBe(false);
    expect(await canViewMap(KICKED_ID, corpMapId)).toBe(false);
    expect(await canViewMap(KICKED_ID, allianceMapId)).toBe(false);
  });

  // ─── mutate rules ──────────────────────────────────────────────────────────
  //
  // `map_update` is the live charting surface (systems, signatures, connections)
  // and is open to EVERY viewer — collaborative mapping is the product. The
  // management rights (`map_delete` etc.) stay derived-authority (`canManageMap`).

  it('every corp member can edit the corp map content; outsiders cannot', async () => {
    expect(await canMutateMap(CORP_A_DIRECTOR_ID, corpMapId, 'map_update')).toBe(true);
    expect(await canMutateMap(CORP_A_MEMBER_ID, corpMapId, 'map_update')).toBe(true);
    expect(await canMutateMap(OWNER_ID, corpMapId, 'map_update')).toBe(true); // plain corp member
    // Corp B outsider has no view → no edit.
    expect(await canMutateMap(CORP_B_MEMBER_ID, corpMapId, 'map_update')).toBe(false);
  });

  it('every alliance member can edit the alliance map content; outsiders cannot', async () => {
    expect(await canMutateMap(CORP_A_DIRECTOR_ID, allianceMapId, 'map_update')).toBe(true);
    // Same-alliance plain member — can view, so can edit.
    expect(await canMutateMap(CORP_A_MEMBER_ID, allianceMapId, 'map_update')).toBe(true);
    // Alliance X pilot is in Corp B but still in the alliance → can view + edit.
    expect(await canMutateMap(ALLIANCE_X_PILOT_ID, allianceMapId, 'map_update')).toBe(true);
    // Corp B member is in a different alliance entirely → no view, no edit.
    expect(await canMutateMap(CORP_B_MEMBER_ID, allianceMapId, 'map_update')).toBe(false);
  });

  it('private map: owner edits, deletes; a non-viewer cannot edit', async () => {
    expect(await canMutateMap(OWNER_ID, privateMapId, 'map_update')).toBe(true);
    expect(await canMutateMap(OWNER_ID, privateMapId, 'map_delete')).toBe(true);
    expect(await canMutateMap(CORP_A_MEMBER_ID, privateMapId, 'map_delete')).toBe(false);
    // A corp-mate / Director cannot even VIEW a private map, so cannot edit it.
    expect(await canMutateMap(CORP_A_DIRECTOR_ID, privateMapId, 'map_update')).toBe(false);
  });

  it('a role-overlay viewer can edit content but cannot manage', async () => {
    // Viewing rights (here via the corp-title role overlay) grant content editing.
    expect(await canViewMap(ROLE_HOLDER_ID, roleScopedMapId)).toBe(true);
    expect(await canMutateMap(ROLE_HOLDER_ID, roleScopedMapId, 'map_update')).toBe(true);
    // But not the management surface.
    expect(await canMutateMap(ROLE_HOLDER_ID, roleScopedMapId, 'map_delete')).toBe(false);
    expect(await canManageMap(ROLE_HOLDER_ID, roleScopedMapId)).toBe(false);
  });

  it('canManageMap gates the in-place settings / webhooks / audit surfaces', async () => {
    // The map Settings management tabs, `GET /api/map/[id]/webhooks` + its
    // actions, and `GET /api/map/[id]/audit` all gate on `canManageMap`. The
    // private owner, the owning-corp Director, the executor-corp Director (for
    // the alliance map), and admin can manage; plain members with view access
    // cannot.
    expect(await canManageMap(OWNER_ID, privateMapId)).toBe(true);
    expect(await canManageMap(CORP_A_DIRECTOR_ID, corpMapId)).toBe(true);
    expect(await canManageMap(CORP_A_DIRECTOR_ID, allianceMapId)).toBe(true);
    expect(await canManageMap(ADMIN_ID, corpMapId)).toBe(true);

    // Plain members who can VIEW the map still cannot manage it.
    expect(await canManageMap(CORP_A_MEMBER_ID, corpMapId)).toBe(false);
    expect(await canManageMap(OWNER_ID, corpMapId)).toBe(false); // corp-mate, not Director
    expect(await canManageMap(ALLIANCE_X_PILOT_ID, allianceMapId)).toBe(false); // not executor corp
    expect(await canManageMap(KICKED_ID, corpMapId)).toBe(false);
  });

  // ─── per-title feature delegation (R4) ───────────────────────────────────
  //
  // A `corp_title` role granted a single `map_capability` on a map lets its
  // holders use that one feature without full management authority. Directors /
  // owners / admins hold every capability implicitly.

  it('hasMapCapability is true only for the granted capability a holder holds', async () => {
    // Role holder holds the `audit_view` grant on the corp map.
    expect(await hasMapCapability(ROLE_HOLDER_ID, corpMapId, 'audit_view')).toBe(true);
    // …but not any other capability.
    expect(await hasMapCapability(ROLE_HOLDER_ID, corpMapId, 'webhooks_manage')).toBe(false);
    // A corp member who does not hold the role has no grant.
    expect(await hasMapCapability(CORP_A_MEMBER_ID, corpMapId, 'audit_view')).toBe(false);
    // A manager holds no explicit grant row (authority is implicit).
    expect(await hasMapCapability(CORP_A_DIRECTOR_ID, corpMapId, 'audit_view')).toBe(false);
  });

  it('canUseMapFeature: holder via grant, manager implicitly, non-holder denied', async () => {
    // Holder passes the delegated feature via the grant, but only that feature.
    expect(await canUseMapFeature(ROLE_HOLDER_ID, corpMapId, 'audit_view')).toBe(true);
    expect(await canUseMapFeature(ROLE_HOLDER_ID, corpMapId, 'settings_manage')).toBe(false);
    // Manager passes every capability without any grant.
    expect(await canUseMapFeature(CORP_A_DIRECTOR_ID, corpMapId, 'audit_view')).toBe(true);
    expect(await canUseMapFeature(CORP_A_DIRECTOR_ID, corpMapId, 'webhooks_manage')).toBe(true);
    // Admin passes everything.
    expect(await canUseMapFeature(ADMIN_ID, corpMapId, 'map_delete')).toBe(true);
    // A viewer with no grant and no management authority is denied.
    expect(await canUseMapFeature(CORP_A_MEMBER_ID, corpMapId, 'audit_view')).toBe(false);
  });

  it('resolveMapCapabilities: manager gets all, holder gets the union of grants', async () => {
    const managerCaps = await resolveMapCapabilities(CORP_A_DIRECTOR_ID, corpMapId);
    expect(managerCaps.size).toBe(7);
    expect(managerCaps.has('map_delete')).toBe(true);

    const holderCaps = await resolveMapCapabilities(ROLE_HOLDER_ID, corpMapId);
    expect([...holderCaps].sort()).toEqual(['audit_view']);

    const nonHolderCaps = await resolveMapCapabilities(CORP_A_MEMBER_ID, corpMapId);
    expect(nonHolderCaps.size).toBe(0);
  });

  // ─── requireMapCapability guard (the gate every delegated route/action uses) ──
  //
  // Every director-gated feature (audit / webhooks / settings / import / export /
  // delete) resolves through `requireMapCapability`, which returns the tuple the
  // route maps to an HTTP status: `ok` → 200, else `status` (401/403/404). This
  // is the end-to-end authorization decision behind those endpoints.

  const FEATURES: MapCapability[] = [
    'audit_view',
    'webhooks_manage',
    'settings_manage',
    'map_import',
    'map_export',
    'map_delete',
  ];

  it('holder with only audit_view passes audit, is forbidden on every other feature', async () => {
    const session = sess(ROLE_HOLDER_ID);
    // Audit is granted → ok (200).
    expect(await requireMapCapability(session, corpMapId, 'audit_view')).toMatchObject({
      ok: true,
    });
    // Every other feature → 403 (the holder can view the map via the role overlay,
    // so it is not a 404).
    for (const cap of FEATURES.filter((c) => c !== 'audit_view')) {
      expect(await requireMapCapability(session, corpMapId, cap)).toMatchObject({
        ok: false,
        status: 403,
      });
    }
  });

  it('manager passes every delegated feature without an explicit grant', async () => {
    const session = sess(CORP_A_DIRECTOR_ID);
    for (const cap of FEATURES) {
      expect(await requireMapCapability(session, corpMapId, cap)).toMatchObject({ ok: true });
    }
  });

  it('a plain viewer is forbidden on every feature but can still view the map', async () => {
    // Corp A member can VIEW the corp map (ownership) but holds no capability.
    expect(await canViewMap(CORP_A_MEMBER_ID, corpMapId)).toBe(true);
    const session = sess(CORP_A_MEMBER_ID);
    for (const cap of FEATURES) {
      expect(await requireMapCapability(session, corpMapId, cap)).toMatchObject({
        ok: false,
        status: 403,
      });
    }
  });

  it('a non-viewer gets 404 (existence is not leaked), no session gets 401', async () => {
    // Corp B member cannot view the corp map and holds no role on it → 404.
    const outsider = sess(CORP_B_MEMBER_ID);
    expect(await requireMapCapability(outsider, corpMapId, 'audit_view')).toMatchObject({
      ok: false,
      status: 404,
    });
    // No session → 401.
    expect(await requireMapCapability(null, corpMapId, 'audit_view')).toMatchObject({
      ok: false,
      status: 401,
    });
  });

  it('admin manages every map for every right', async () => {
    for (const id of [privateMapId, corpMapId, allianceMapId, roleScopedMapId]) {
      expect(await canMutateMap(ADMIN_ID, id, 'map_update')).toBe(true);
      expect(await canMutateMap(ADMIN_ID, id, 'map_delete')).toBe(true);
      expect(await canMutateMap(ADMIN_ID, id, 'map_share')).toBe(true);
      expect(await canMutateMap(ADMIN_ID, id, 'map_import')).toBe(true);
      expect(await canMutateMap(ADMIN_ID, id, 'map_export')).toBe(true);
    }
  });

  it('canCreateMap derives from EVE state: private→any, corp/alliance→Director', async () => {
    expect(await canCreateMap(CORP_A_MEMBER_ID, 'private')).toBe(true);
    expect(await canCreateMap(CORP_A_MEMBER_ID, 'corp')).toBe(false);
    expect(await canCreateMap(CORP_A_DIRECTOR_ID, 'corp')).toBe(true);
    // Corp A is the executor of Alliance X → its Director can create alliance maps.
    expect(await canCreateMap(CORP_A_DIRECTOR_ID, 'alliance')).toBe(true);
    expect(await canCreateMap(ADMIN_ID, 'corp')).toBe(true);
    expect(await canCreateMap(KICKED_ID, 'private')).toBe(false);
  });

  it('isAdmin gates the admin probe', async () => {
    expect(await isAdmin({ characterId: ADMIN_ID.toString(), userId: 0 } as never)).toBe(true);
    expect(await isAdmin({ characterId: CORP_A_MEMBER_ID.toString(), userId: 0 } as never)).toBe(false);
    expect(await isAdmin(null)).toBe(false);
  });

  // ─── listViewableMaps ────────────────────────────────────────────────────

  it('listViewableMaps matches per-check results', async () => {
    const adminList = await listViewableMaps(ADMIN_ID);
    expect(adminList.map((m) => m.id)).toEqual(
      expect.arrayContaining([
        privateMapId.toString(),
        corpMapId.toString(),
        allianceMapId.toString(),
        roleScopedMapId.toString(),
      ]),
    );

    const memberList = await listViewableMaps(CORP_A_MEMBER_ID);
    const memberIds = memberList.map((m) => m.id);
    expect(memberIds).toContain(corpMapId.toString());
    expect(memberIds).toContain(allianceMapId.toString());
    expect(memberIds).not.toContain(privateMapId.toString());
    expect(memberIds).not.toContain(roleScopedMapId.toString());

    const roleHolderList = await listViewableMaps(ROLE_HOLDER_ID);
    expect(roleHolderList.map((m) => m.id)).toContain(roleScopedMapId.toString());
  });

  // ─── character-cleanup ───────────────────────────────────────────────────

  it('character-cleanup expires past kicks and leaves bans alone', async () => {
    // Set up: one expired kick, one not-yet-expired kick, one ban.
    const ID_EXPIRED = 99003001n;
    const ID_FUTURE = 99003002n;
    const ID_BANNED = 99003003n;
    await db.insert(apCharacter).values([
      mkChar(ID_EXPIRED, 'Expired Kick', {
        status: 'kicked',
        statusExpiresAt: new Date(Date.now() - 60_000),
      }),
      mkChar(ID_FUTURE, 'Future Kick', {
        status: 'kicked',
        statusExpiresAt: new Date(Date.now() + 60 * 60_000),
      }),
      mkChar(ID_BANNED, 'Banned', { status: 'banned' }),
    ]);

    // Run the cron handler directly. The instrumentation wrapper requires a
    // helpers object; we don't actually use it (no addJob inside).
    await characterCleanup.run({}, { addJob: vi.fn() } as never);

    const rows = await db
      .select({ id: apCharacter.id, status: apCharacter.status, expires: apCharacter.statusExpiresAt })
      .from(apCharacter)
      .where(inArray(apCharacter.id, [ID_EXPIRED, ID_FUTURE, ID_BANNED]));
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(ID_EXPIRED)).toEqual(
      expect.objectContaining({ status: 'active', expires: null }),
    );
    expect(byId.get(ID_FUTURE)).toEqual(
      expect.objectContaining({ status: 'kicked' }),
    );
    expect(byId.get(ID_FUTURE)?.expires).not.toBeNull();
    expect(byId.get(ID_BANNED)).toEqual(
      expect.objectContaining({ status: 'banned' }),
    );

    await db.delete(apCharacter).where(inArray(apCharacter.id, [ID_EXPIRED, ID_FUTURE, ID_BANNED]));
  });
});

// ─── helpers ───────────────────────────────────────────────────────────────

interface CharOverrides {
  authzLevel?: 'member' | 'admin';
  corporationId?: bigint;
  allianceId?: bigint;
  isDirector?: boolean;
  status?: 'active' | 'kicked' | 'banned';
  statusExpiresAt?: Date;
}

/** Minimal session stand-in for the `requireMap*` tuple guards. */
function sess(characterId: bigint) {
  return { characterId: characterId.toString(), userId: 0 } as never;
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
    isDirector: overrides.isDirector ?? false,
    status: overrides.status ?? 'active',
    statusExpiresAt: overrides.statusExpiresAt ?? null,
  } as const;
}

async function cleanup() {
  await db
    .delete(apMapRoleAccess)
    .where(inArray(apMapRoleAccess.roleId, [CORP_TITLE_ROLE_ID]));
  // Soft-delete-only check needs to drop both deleted and live rows.
  await db
    .delete(apMap)
    .where(
      sql`name IN ('Owner Private', 'Corp A Map', 'Alliance X Map', 'Role-Scoped Map')`,
    );
  await db
    .delete(apCharacterRole)
    .where(inArray(apCharacterRole.characterId, characterIds));
  await db.delete(apRole).where(eq(apRole.id, CORP_TITLE_ROLE_ID));
  await db.delete(apCharacter).where(inArray(apCharacter.id, characterIds));
  await db.delete(apCorporation).where(inArray(apCorporation.id, [CORP_A, CORP_B]));
  await db.delete(apAlliance).where(inArray(apAlliance.id, [ALLIANCE_X, ALLIANCE_Y]));
  if (userId) {
    await db.delete(apUser).where(eq(apUser.id, userId));
    userId = 0;
  }
  // Reset the captured map ids so reruns don't reference stale values.
  privateMapId = 0n;
  corpMapId = 0n;
  allianceMapId = 0n;
  roleScopedMapId = 0n;
}
