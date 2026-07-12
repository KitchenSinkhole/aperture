// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { and, eq, inArray } from 'drizzle-orm';
import { db, pool } from '@/db/client';
import {
  apCharacter,
  apCharacterRole,
  apCorporation,
  apMap,
  apMapEvent,
  apMapRoleAccess,
  apRole,
  apUser,
} from '@/db/schema';
import { hasMapCapability } from '@/lib/auth/rights';
import { queryAuditEvents } from '@/lib/map/audit';

/**
 * Per-title feature delegation (R4) — the `mapRoles` Server Actions end-to-end
 * against real Postgres. The session layer can't run headless, so we mock
 * `requireSession` and drive `getMapDelegationState` / `setMapDelegation` as a
 * manager (the corp Director), a plain member, exercising: the corp-scope
 * filter, the forged-role rejection, and the audit-event a grant/revoke commits.
 *
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test title-delegation
 */
const run = process.env.RUN_DB_TESTS === '1';

// The mocked session's acting character — each test sets who is "logged in".
const h = vi.hoisted(() => ({ actingCharacterId: '0' }));
vi.mock('@/lib/session', () => ({
  requireSession: async () => ({ characterId: h.actingCharacterId, userId: 0 }),
}));

// Imported after the mock so the actions bind the mocked `requireSession`.
const { getMapDelegationState, setMapDelegation } = await import('@/app/(app)/actions/mapRoles');

const CORP_A = 98100001n;
const CORP_B = 98100002n;

const DIRECTOR_ID = 98101001n;
const MEMBER_ID = 98101002n;

const TITLE_A_LOGI = 98102001n; // corp_title of CORP_A, held by MEMBER_ID
const TITLE_A_SCOUT = 98102002n; // corp_title of CORP_A, held by nobody
const TITLE_B_FOREIGN = 98102003n; // corp_title of CORP_B — never eligible on a CORP_A map

const characterIds = [DIRECTOR_ID, MEMBER_ID];
const roleIds = [TITLE_A_LOGI, TITLE_A_SCOUT, TITLE_B_FOREIGN];

let userId = 0;
let corpMapId = 0n;
let privateMapId = 0n;

function actAs(id: bigint) {
  h.actingCharacterId = id.toString();
}

describe.skipIf(!run)('per-title feature delegation actions (real Postgres)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    await cleanup();

    const [u] = await db.insert(apUser).values({}).returning({ id: apUser.id });
    userId = u!.id;

    await db.insert(apCorporation).values([
      { id: CORP_A, name: 'Delegation Corp A' },
      { id: CORP_B, name: 'Delegation Corp B' },
    ]);

    await db.insert(apCharacter).values([
      mkChar(DIRECTOR_ID, 'Deleg Director', { corporationId: CORP_A, isDirector: true }),
      mkChar(MEMBER_ID, 'Deleg Member', { corporationId: CORP_A }),
    ]);

    await db.insert(apRole).values([
      { id: TITLE_A_LOGI, source: 'corp_title', externalRef: `${CORP_A}:10`, name: 'Logistics', corporationId: CORP_A },
      { id: TITLE_A_SCOUT, source: 'corp_title', externalRef: `${CORP_A}:11`, name: 'Scouts', corporationId: CORP_A },
      { id: TITLE_B_FOREIGN, source: 'corp_title', externalRef: `${CORP_B}:10`, name: 'Foreign', corporationId: CORP_B },
    ]);
    await db.insert(apCharacterRole).values({
      characterId: MEMBER_ID,
      roleId: TITLE_A_LOGI,
      grantedBy: 'corp-title-sync',
    });

    const inserted = await db
      .insert(apMap)
      .values([
        { name: 'Deleg Corp Map', scope: 'all', type: 'corp', ownerCorporationId: CORP_A },
        { name: 'Deleg Private Map', scope: 'wh', type: 'private', ownerCharacterId: DIRECTOR_ID },
      ])
      .returning({ id: apMap.id, name: apMap.name });
    corpMapId = inserted.find((m) => m.name === 'Deleg Corp Map')!.id;
    privateMapId = inserted.find((m) => m.name === 'Deleg Private Map')!.id;
  });

  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  it('lists the owning corp titles with empty grants, manager-gated', async () => {
    actAs(DIRECTOR_ID);
    const result = await getMapDelegationState(corpMapId.toString());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.available).toBe(true);
    if (!result.data.available) return;
    // Both CORP_A titles, ordered by name; the foreign CORP_B title is excluded.
    expect(result.data.roles.map((r) => r.label)).toEqual(['Logistics', 'Scouts']);
    for (const role of result.data.roles) expect(role.capabilities).toEqual([]);
  });

  it('reports unavailable on a non-corp map', async () => {
    actAs(DIRECTOR_ID);
    const result = await getMapDelegationState(privateMapId.toString());
    expect(result).toMatchObject({ ok: true, data: { available: false } });
  });

  it('a non-manager cannot read delegation state', async () => {
    actAs(MEMBER_ID);
    const result = await getMapDelegationState(corpMapId.toString());
    expect(result).toMatchObject({ ok: false, error: 'Forbidden.' });
  });

  it('grants a capability to a title; state reflects it and the holder gains it', async () => {
    actAs(DIRECTOR_ID);
    const granted = await setMapDelegation({
      mapId: corpMapId.toString(),
      roleId: TITLE_A_LOGI.toString(),
      capability: 'audit_view',
      enabled: true,
    });
    expect(granted.ok).toBe(true);

    const state = await getMapDelegationState(corpMapId.toString());
    expect(state.ok).toBe(true);
    if (!state.ok || !state.data.available) return;
    const logi = state.data.roles.find((r) => r.label === 'Logistics')!;
    expect(logi.capabilities).toEqual(['audit_view']);

    // The member holding that title now passes the delegated feature gate.
    expect(await hasMapCapability(MEMBER_ID, corpMapId, 'audit_view')).toBe(true);
    expect(await hasMapCapability(MEMBER_ID, corpMapId, 'webhooks_manage')).toBe(false);
  });

  it('the grant lands exactly one access.granted audit event naming the title', async () => {
    const events = await db
      .select({ kind: apMapEvent.kind, payload: apMapEvent.payload })
      .from(apMapEvent)
      .where(and(eq(apMapEvent.mapId, corpMapId), eq(apMapEvent.kind, 'access.granted')));
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ roleName: 'Logistics', capability: 'audit_view' });

    const page = await queryAuditEvents({ mapId: corpMapId, kinds: ['access.granted'] });
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]).toMatchObject({
      category: 'access',
      summary: 'Granted title **Logistics** audit-log access.',
    });
  });

  it('revokes the capability; state clears and one access.revoked event lands', async () => {
    actAs(DIRECTOR_ID);
    const revoked = await setMapDelegation({
      mapId: corpMapId.toString(),
      roleId: TITLE_A_LOGI.toString(),
      capability: 'audit_view',
      enabled: false,
    });
    expect(revoked.ok).toBe(true);

    const state = await getMapDelegationState(corpMapId.toString());
    if (!state.ok || !state.data.available) throw new Error('expected available corp map');
    const logi = state.data.roles.find((r) => r.label === 'Logistics')!;
    expect(logi.capabilities).toEqual([]);
    expect(await hasMapCapability(MEMBER_ID, corpMapId, 'audit_view')).toBe(false);

    const revokedEvents = await db
      .select({ kind: apMapEvent.kind })
      .from(apMapEvent)
      .where(and(eq(apMapEvent.mapId, corpMapId), eq(apMapEvent.kind, 'access.revoked')));
    expect(revokedEvents).toHaveLength(1);
  });

  it('rejects the implicit view capability', async () => {
    actAs(DIRECTOR_ID);
    const result = await setMapDelegation({
      mapId: corpMapId.toString(),
      roleId: TITLE_A_LOGI.toString(),
      // `view` is never delegatable — the schema excludes it.
      capability: 'view' as never,
      enabled: true,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a title from another corp (forged roleId)', async () => {
    actAs(DIRECTOR_ID);
    const result = await setMapDelegation({
      mapId: corpMapId.toString(),
      roleId: TITLE_B_FOREIGN.toString(),
      capability: 'audit_view',
      enabled: true,
    });
    expect(result).toMatchObject({ ok: false, error: 'Title not found for this map.' });
  });

  it('a non-manager cannot delegate', async () => {
    actAs(MEMBER_ID);
    const result = await setMapDelegation({
      mapId: corpMapId.toString(),
      roleId: TITLE_A_LOGI.toString(),
      capability: 'audit_view',
      enabled: true,
    });
    expect(result).toMatchObject({ ok: false, error: 'Forbidden.' });
  });
});

// ─── helpers ───────────────────────────────────────────────────────────────

interface CharOverrides {
  corporationId?: bigint;
  isDirector?: boolean;
}

function mkChar(id: bigint, name: string, overrides: CharOverrides = {}) {
  return {
    id,
    userId,
    name,
    ownerHash: `deleg-hash-${id.toString()}`,
    authzLevel: 'member' as const,
    corporationId: overrides.corporationId ?? null,
    allianceId: null,
    isDirector: overrides.isDirector ?? false,
    status: 'active' as const,
    statusExpiresAt: null,
  };
}

async function cleanup() {
  await db.delete(apMap).where(inArray(apMap.id, [corpMapId, privateMapId].filter((x) => x !== 0n)));
  await db.delete(apMapRoleAccess).where(inArray(apMapRoleAccess.roleId, roleIds));
  await db.delete(apCharacterRole).where(inArray(apCharacterRole.characterId, characterIds));
  await db.delete(apRole).where(inArray(apRole.id, roleIds));
  await db.delete(apCharacter).where(inArray(apCharacter.id, characterIds));
  await db.delete(apCorporation).where(inArray(apCorporation.id, [CORP_A, CORP_B]));
  if (userId) {
    await db.delete(apUser).where(eq(apUser.id, userId));
    userId = 0;
  }
  corpMapId = 0n;
  privateMapId = 0n;
}
