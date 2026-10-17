// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { and, eq, inArray } from 'drizzle-orm';
import { Client } from 'pg';
import type { Session } from 'next-auth';
import { db, pool } from '@/db/client';
import {
  apAccessGrant,
  apCharacter,
  apCorporation,
  apInstance,
  apRole,
  apUser,
} from '@/db/schema';
import { env } from '@/lib/env';
import { apertureConfig } from '../../aperture.config';

/**
 * Blackout admin actions (real Postgres): the switch, the cleared list, the
 * panel loader, and the instance-channel notify every mutation commits with.
 *
 * `ap_instance` is a live singleton, so the switch is snapshotted in `beforeAll`
 * and restored in `afterAll`. Ids use a 9722xxxx block.
 *
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test admin-blackout
 */
const run = process.env.RUN_DB_TESTS === '1';

let currentSession: Session | null = null;
vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => currentSession) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const {
  adminAddBlackoutClearance,
  adminEndBlackout,
  adminLoadBlackoutPanel,
  adminRemoveBlackoutClearance,
  adminStartBlackout,
} = await import('@/app/(admin)/actions/blackout');

const CORP = 97229001n;
const OUTSIDE_CORP = 97229002n;
const OUTSIDE_ALLIANCE = 97229003n;

const ADMIN_CHAR = 97220001n;
const DIRECTOR_CHAR = 97220002n; // corp Director, member authz: denied
const MEMBER_CHAR = 97220003n;
const SCOUT_CHAR = 97220004n; // the character the tests clear by name
const UNKNOWN_CHAR = 97220099n; // never inserted

const TITLE = 97222001n;
const EXTERNAL_ROLE = 97222002n; // not a corp title
const UNKNOWN_ROLE = 97222099n;

const characterIds = [ADMIN_CHAR, DIRECTOR_CHAR, MEMBER_CHAR, SCOUT_CHAR];
const roleIds = [TITLE, EXTERNAL_ROLE];

let userId = 0;
let instanceSnapshot: typeof apInstance.$inferSelect | undefined;
let listener: Client;
const notifications: string[] = [];

function asSession(characterId: bigint): Session {
  return { characterId: characterId.toString(), user: { id: '0' } } as unknown as Session;
}

describe.skipIf(!run)('Blackout admin actions (real Postgres)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    [instanceSnapshot] = await db.select().from(apInstance).where(eq(apInstance.id, 1));
    await cleanup();

    const [u] = await db.insert(apUser).values({}).returning({ id: apUser.id });
    userId = u!.id;
    await db.insert(apCorporation).values({ id: CORP, name: 'Blackout Admin Corp' });
    await db.insert(apCharacter).values([
      mkChar(ADMIN_CHAR, 'Blackout Admin', { authzLevel: 'admin' }),
      mkChar(DIRECTOR_CHAR, 'Blackout Director', { isDirector: true }),
      mkChar(MEMBER_CHAR, 'Blackout Member'),
      mkChar(SCOUT_CHAR, 'Blackout Scout'),
    ]);
    await db.insert(apRole).values([
      { id: TITLE, source: 'corp_title', externalRef: `${CORP}:1`, name: 'FC', corporationId: CORP },
      { id: EXTERNAL_ROLE, source: 'external', externalRef: `blackout-${EXTERNAL_ROLE}`, name: 'Discord FC' },
    ]);
    await setSwitch(null, null);

    listener = new Client({ connectionString: env.DATABASE_URL });
    await listener.connect();
    listener.on('notification', (msg) => notifications.push(msg.channel));
    await listener.query(`LISTEN "${apertureConfig.INSTANCE_NOTIFY_CHANNEL}"`);
  });

  afterAll(async () => {
    await listener?.end();
    if (instanceSnapshot) {
      await setSwitch(instanceSnapshot.blackoutSince, instanceSnapshot.blackoutByCharacterId);
    } else {
      await db.delete(apInstance).where(eq(apInstance.id, 1));
    }
    await cleanup();
    await pool.end();
  });

  beforeEach(async () => {
    currentSession = null;
    await setSwitch(null, null);
    await db.delete(apAccessGrant).where(grantsUnderTest());
  });

  describe('gating', () => {
    for (const [who, session] of [
      ['a corp Director', () => asSession(DIRECTOR_CHAR)],
      ['a plain member', () => asSession(MEMBER_CHAR)],
      ['an unauthenticated session', () => null],
    ] as const) {
      it(`rejects ${who} on every action and emits nothing`, async () => {
        const [grant] = await db
          .insert(apAccessGrant)
          .values(blackoutGrant('character', SCOUT_CHAR))
          .returning({ id: apAccessGrant.id });
        currentSession = session();
        notifications.length = 0;

        expect((await adminStartBlackout()).ok).toBe(false);
        expect((await readSwitch()).since).toBeNull();

        await setSwitch(new Date('2026-10-17T12:00:00Z'), ADMIN_CHAR);
        expect((await adminEndBlackout()).ok).toBe(false);
        expect((await readSwitch()).since).not.toBeNull();

        expect((await adminAddBlackoutClearance(addInput('character', MEMBER_CHAR))).ok).toBe(false);
        expect(await grantFor('character', MEMBER_CHAR)).toBeUndefined();

        expect((await adminRemoveBlackoutClearance(grant!.id.toString())).ok).toBe(false);
        expect(await grantFor('character', SCOUT_CHAR)).toBeDefined();

        expect((await adminLoadBlackoutPanel()).ok).toBe(false);
        expect(await notificationsAfterSettle()).toEqual([]);
      });
    }
  });

  describe('the switch', () => {
    it('turning on sets since and by, and notifies', async () => {
      currentSession = asSession(ADMIN_CHAR);
      const before = Date.now();
      expect(await expectNotify(() => adminStartBlackout())).toEqual({ ok: true });
      const state = await readSwitch();
      expect(state.since!.getTime()).toBeGreaterThanOrEqual(before - 5_000);
      expect(state.by).toBe(ADMIN_CHAR);
    });

    it('turning on while on keeps the original start and admin', async () => {
      const since = new Date('2026-10-17T12:00:00Z');
      await setSwitch(since, SCOUT_CHAR);
      currentSession = asSession(ADMIN_CHAR);
      expect((await adminStartBlackout()).ok).toBe(true);
      expect(await readSwitch()).toEqual({ since, by: SCOUT_CHAR });
    });

    it('turning off clears since and by, and notifies', async () => {
      await setSwitch(new Date('2026-10-17T12:00:00Z'), ADMIN_CHAR);
      currentSession = asSession(ADMIN_CHAR);
      expect(await expectNotify(() => adminEndBlackout())).toEqual({ ok: true });
      expect(await readSwitch()).toEqual({ since: null, by: null });
    });
  });

  describe('adding to the cleared list', () => {
    beforeEach(() => {
      currentSession = asSession(ADMIN_CHAR);
    });

    it('stores a character with its expiry, note and granting admin, and notifies', async () => {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      expiresAt.setMilliseconds(0);
      const result = await expectNotify(() =>
        adminAddBlackoutClearance({
          ...addInput('character', SCOUT_CHAR),
          expiresAt: expiresAt.toISOString(),
          note: '  home defense  ',
        }),
      );
      expect(result).toEqual({ ok: true });
      const row = await grantFor('character', SCOUT_CHAR);
      expect(row).toMatchObject({
        scope: 'instance',
        mapId: null,
        capability: 'blackout_view',
        expiresAt,
        note: 'home defense',
        grantedByCharacterId: ADMIN_CHAR,
      });
    });

    it('stores a corp title as a permanent grant with no note, and notifies', async () => {
      expect(await expectNotify(() => adminAddBlackoutClearance(addInput('role', TITLE)))).toEqual({
        ok: true,
      });
      expect(await grantFor('role', TITLE)).toMatchObject({ expiresAt: null, note: null });
    });

    it('re-adding replaces the expiry and note', async () => {
      await adminAddBlackoutClearance({ ...addInput('character', SCOUT_CHAR), note: 'first' });
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      expiresAt.setMilliseconds(0);
      await adminAddBlackoutClearance({
        ...addInput('character', SCOUT_CHAR),
        expiresAt: expiresAt.toISOString(),
        note: 'second',
      });
      const rows = await db.select().from(apAccessGrant).where(grantsUnderTest());
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ expiresAt, note: 'second' });
    });

    it('rejects corporation and alliance principals', async () => {
      for (const [kind, id] of [
        ['corporation', OUTSIDE_CORP],
        ['alliance', OUTSIDE_ALLIANCE],
      ] as const) {
        const result = await adminAddBlackoutClearance({
          principalKind: kind as 'character',
          principalId: id.toString(),
          expiresAt: '',
          note: '',
        });
        expect(result.ok).toBe(false);
        expect(await grantFor(kind, id)).toBeUndefined();
      }
    });

    it('rejects an unknown character, an unknown role and a role that is not a corp title', async () => {
      notifications.length = 0;
      for (const [kind, id] of [
        ['character', UNKNOWN_CHAR],
        ['role', UNKNOWN_ROLE],
        ['role', EXTERNAL_ROLE],
      ] as const) {
        expect((await adminAddBlackoutClearance(addInput(kind, id))).ok).toBe(false);
        expect(await grantFor(kind, id)).toBeUndefined();
      }
      expect(await notificationsAfterSettle()).toEqual([]);
    });

    it('rejects an expiry in the past', async () => {
      const result = await adminAddBlackoutClearance({
        ...addInput('character', SCOUT_CHAR),
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      });
      expect(result.ok).toBe(false);
      expect(await grantFor('character', SCOUT_CHAR)).toBeUndefined();
    });
  });

  describe('removing from the cleared list', () => {
    beforeEach(() => {
      currentSession = asSession(ADMIN_CHAR);
    });

    it('removes a blackout_view grant and notifies', async () => {
      const [grant] = await db
        .insert(apAccessGrant)
        .values(blackoutGrant('role', TITLE))
        .returning({ id: apAccessGrant.id });
      expect(
        await expectNotify(() => adminRemoveBlackoutClearance(grant!.id.toString())),
      ).toEqual({ ok: true });
      expect(await grantFor('role', TITLE)).toBeUndefined();
    });

    it('refuses a login or admin grant and emits nothing', async () => {
      const inserted = await db
        .insert(apAccessGrant)
        .values([
          { ...blackoutGrant('character', SCOUT_CHAR), capability: 'login' as const },
          { ...blackoutGrant('character', MEMBER_CHAR), capability: 'admin' as const },
        ])
        .returning({ id: apAccessGrant.id });
      notifications.length = 0;
      for (const { id } of inserted) {
        expect((await adminRemoveBlackoutClearance(id.toString())).ok).toBe(false);
      }
      const remaining = await db
        .select({ id: apAccessGrant.id })
        .from(apAccessGrant)
        .where(inArray(apAccessGrant.id, inserted.map((r) => r.id)));
      expect(remaining).toHaveLength(2);
      expect(await notificationsAfterSettle()).toEqual([]);
    });
  });

  describe('adminLoadBlackoutPanel', () => {
    it('lists the switch, the cleared list with names, and the picker options', async () => {
      const since = new Date('2026-10-17T12:00:00Z');
      await setSwitch(since, ADMIN_CHAR);
      await db.insert(apAccessGrant).values([
        { ...blackoutGrant('character', SCOUT_CHAR), note: 'scout' },
        { ...blackoutGrant('role', TITLE), expiresAt: new Date(Date.now() - 60_000) },
        { ...blackoutGrant('character', MEMBER_CHAR), capability: 'login' as const },
      ]);
      currentSession = asSession(ADMIN_CHAR);

      const result = await adminLoadBlackoutPanel();
      if (!result.ok) throw new Error(result.error);
      const { data } = result;

      expect(data).toMatchObject({
        active: true,
        since: since.toISOString(),
        byCharacterName: 'Blackout Admin',
      });
      const ours = data.clearances.filter((c) =>
        [SCOUT_CHAR.toString(), TITLE.toString()].includes(c.principalId),
      );
      expect(ours).toEqual([
        expect.objectContaining({
          principalKind: 'character',
          name: 'Blackout Scout',
          corporationName: null,
          expiresAt: null,
          expired: false,
          note: 'scout',
        }),
        expect.objectContaining({
          principalKind: 'role',
          name: 'FC',
          corporationName: 'Blackout Admin Corp',
          expired: true,
        }),
      ]);
      expect(data.clearances.some((c) => c.principalId === MEMBER_CHAR.toString())).toBe(false);
      expect(data.characters).toContainEqual({ id: SCOUT_CHAR.toString(), name: 'Blackout Scout' });
      expect(data.titles).toContainEqual({
        roleId: TITLE.toString(),
        label: 'FC',
        corporationId: CORP.toString(),
        corporationName: 'Blackout Admin Corp',
      });
      expect(data.titles.some((t) => t.roleId === EXTERNAL_ROLE.toString())).toBe(false);
    });
  });
});

// ─── helpers ───────────────────────────────────────────────────────────────

function mkChar(
  id: bigint,
  name: string,
  overrides: { authzLevel?: 'member' | 'admin'; isDirector?: boolean } = {},
) {
  return {
    id,
    userId,
    name,
    ownerHash: `blackout-admin-hash-${id.toString()}`,
    authzLevel: overrides.authzLevel ?? 'member',
    isDirector: overrides.isDirector ?? false,
    corporationId: CORP,
  };
}

function addInput(principalKind: 'character' | 'role', principalId: bigint) {
  return { principalKind, principalId: principalId.toString(), expiresAt: '', note: '' };
}

function blackoutGrant(principalKind: 'character' | 'role', principalId: bigint) {
  return {
    principalKind,
    principalId,
    scope: 'instance' as const,
    mapId: null,
    capability: 'blackout_view' as const,
  };
}

function grantsUnderTest() {
  return inArray(apAccessGrant.principalId, [
    ...characterIds,
    UNKNOWN_CHAR,
    ...roleIds,
    UNKNOWN_ROLE,
    OUTSIDE_CORP,
    OUTSIDE_ALLIANCE,
  ]);
}

async function grantFor(
  principalKind: 'character' | 'role' | 'corporation' | 'alliance',
  principalId: bigint,
) {
  const [row] = await db
    .select()
    .from(apAccessGrant)
    .where(
      and(eq(apAccessGrant.principalKind, principalKind), eq(apAccessGrant.principalId, principalId)),
    );
  return row;
}

async function setSwitch(since: Date | null, byCharacterId: bigint | null) {
  await db
    .update(apInstance)
    .set({ blackoutSince: since, blackoutByCharacterId: byCharacterId })
    .where(eq(apInstance.id, 1));
}

async function readSwitch() {
  const [row] = await db
    .select({ since: apInstance.blackoutSince, by: apInstance.blackoutByCharacterId })
    .from(apInstance)
    .where(eq(apInstance.id, 1));
  return row!;
}

/** Run `fn` and wait for exactly one instance-channel notify. */
async function expectNotify<T>(fn: () => Promise<T>): Promise<T> {
  notifications.length = 0;
  const result = await fn();
  const deadline = Date.now() + 2_000;
  while (notifications.length === 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 20));
  }
  expect(await notificationsAfterSettle()).toEqual([apertureConfig.INSTANCE_NOTIFY_CHANNEL]);
  return result;
}

/** The notifies received so far, after giving any in-flight one time to land. */
async function notificationsAfterSettle(): Promise<string[]> {
  await new Promise((r) => setTimeout(r, 200));
  return [...notifications];
}

async function cleanup() {
  await db.delete(apAccessGrant).where(grantsUnderTest());
  await db.delete(apRole).where(inArray(apRole.id, roleIds));
  const users = await db
    .select({ userId: apCharacter.userId })
    .from(apCharacter)
    .where(inArray(apCharacter.id, characterIds));
  await db.delete(apCharacter).where(inArray(apCharacter.id, characterIds));
  const userIds = [...new Set([...users.map((u) => u.userId), userId])].filter((id) => id !== 0);
  if (userIds.length > 0) await db.delete(apUser).where(inArray(apUser.id, userIds));
  await db.delete(apCorporation).where(eq(apCorporation.id, CORP));
}
