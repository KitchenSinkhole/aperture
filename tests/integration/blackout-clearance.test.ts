// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { and, eq, inArray } from 'drizzle-orm';
import { db, pool } from '@/db/client';
import {
  apAccessGrant,
  apCharacter,
  apCharacterRole,
  apCorporation,
  apInstance,
  apInstanceOwner,
  apRole,
  apUser,
} from '@/db/schema';
import { getBlackoutState, isBlackoutCleared } from '@/lib/auth/blackout';
import { isLoginAllowed } from '@/lib/auth/loginGate';

/**
 * Blackout clearance against real Postgres: who `isBlackoutCleared` clears, the
 * CHECKs that keep the cleared list to characters and titles, the login gate
 * ignoring `blackout_view`, and `getBlackoutState` reading the switch.
 *
 * `ap_instance` is a live singleton, so the switch and access mode are
 * snapshotted in `beforeAll` and restored in `afterAll`. Ids use a 9721xxxx block.
 *
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test blackout-clearance
 */
const run = process.env.RUN_DB_TESTS === '1';

const CORP = 97219001n;
const OWNER_CORP = 97219002n;
const OUTSIDE_CORP = 97219003n;
const OUTSIDE_ALLIANCE = 97219004n;
const PROBE_CORP = 97219005n; // the login probe's corp, never granted anything

const ADMIN_CHAR = 97210001n;
const NAMED_CHAR = 97210002n; // holds a by-name grant
const NAMED_ALT = 97210003n; // same account as NAMED_CHAR, no grant of its own
const TITLE_CHAR = 97210004n; // holds TITLE_CLEARED
const EXPIRED_CHAR = 97210005n; // expired by-name grant
const EXPIRED_TITLE_CHAR = 97210006n; // holds TITLE_EXPIRED
const KICKED_CHAR = 97210007n; // kicked, holds a by-name grant
const KICKED_ACCOUNT_ALT = 97210008n; // active, same account as KICKED_CHAR
const BANNED_CHAR = 97210009n; // banned, holds TITLE_CLEARED
const BANNED_ACCOUNT_ALT = 97210010n; // active, same account as BANNED_CHAR
const PLAIN_CHAR = 97210011n;
const LOGIN_PROBE_CHAR = 97210012n; // a blackout_view grant and nothing else

const TITLE_CLEARED = 97212001n;
const TITLE_EXPIRED = 97212002n;

const characterIds = [
  ADMIN_CHAR,
  NAMED_CHAR,
  NAMED_ALT,
  TITLE_CHAR,
  EXPIRED_CHAR,
  EXPIRED_TITLE_CHAR,
  KICKED_CHAR,
  KICKED_ACCOUNT_ALT,
  BANNED_CHAR,
  BANNED_ACCOUNT_ALT,
  PLAIN_CHAR,
  LOGIN_PROBE_CHAR,
];
const roleIds = [TITLE_CLEARED, TITLE_EXPIRED];
const orgIds = [CORP, OWNER_CORP, OUTSIDE_CORP, OUTSIDE_ALLIANCE, PROBE_CORP];

const accounts = {
  admin: 0,
  named: 0,
  title: 0,
  expired: 0,
  kicked: 0,
  banned: 0,
  plain: 0,
  loginProbe: 0,
};

let instanceSnapshot: typeof apInstance.$inferSelect | undefined;

describe.skipIf(!run)('Blackout clearance (real Postgres)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    [instanceSnapshot] = await db.select().from(apInstance).where(eq(apInstance.id, 1));
    await cleanup();

    for (const key of Object.keys(accounts) as Array<keyof typeof accounts>) {
      const [u] = await db.insert(apUser).values({}).returning({ id: apUser.id });
      accounts[key] = u!.id;
    }

    await db.insert(apCorporation).values({ id: CORP, name: 'Blackout Test Corp' });

    await db.insert(apCharacter).values([
      mkChar(ADMIN_CHAR, accounts.admin, { authzLevel: 'admin' }),
      mkChar(NAMED_CHAR, accounts.named),
      mkChar(NAMED_ALT, accounts.named),
      mkChar(TITLE_CHAR, accounts.title),
      mkChar(EXPIRED_CHAR, accounts.expired),
      mkChar(EXPIRED_TITLE_CHAR, accounts.expired),
      mkChar(KICKED_CHAR, accounts.kicked, { status: 'kicked' }),
      mkChar(KICKED_ACCOUNT_ALT, accounts.kicked),
      mkChar(BANNED_CHAR, accounts.banned, { status: 'banned' }),
      mkChar(BANNED_ACCOUNT_ALT, accounts.banned),
      mkChar(PLAIN_CHAR, accounts.plain),
      mkChar(LOGIN_PROBE_CHAR, accounts.loginProbe),
    ]);

    await db.insert(apRole).values([
      { id: TITLE_CLEARED, source: 'corp_title', externalRef: `${CORP}:1`, name: 'FC', corporationId: CORP },
      { id: TITLE_EXPIRED, source: 'corp_title', externalRef: `${CORP}:2`, name: 'Old FC', corporationId: CORP },
    ]);
    await db.insert(apCharacterRole).values([
      { characterId: TITLE_CHAR, roleId: TITLE_CLEARED, grantedBy: 'corp-title-sync' },
      { characterId: EXPIRED_TITLE_CHAR, roleId: TITLE_EXPIRED, grantedBy: 'corp-title-sync' },
      { characterId: BANNED_CHAR, roleId: TITLE_CLEARED, grantedBy: 'corp-title-sync' },
    ]);

    const anHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db.insert(apAccessGrant).values([
      blackoutGrant('character', NAMED_CHAR, tomorrow),
      blackoutGrant('role', TITLE_CLEARED),
      blackoutGrant('character', EXPIRED_CHAR, anHourAgo),
      blackoutGrant('role', TITLE_EXPIRED, anHourAgo),
      blackoutGrant('character', KICKED_CHAR),
      blackoutGrant('character', LOGIN_PROBE_CHAR),
    ]);
  });

  afterAll(async () => {
    await cleanup();
    if (instanceSnapshot) {
      await db
        .update(apInstance)
        .set({
          accessMode: instanceSnapshot.accessMode,
          blackoutSince: instanceSnapshot.blackoutSince,
          blackoutByCharacterId: instanceSnapshot.blackoutByCharacterId,
        })
        .where(eq(apInstance.id, 1));
    }
    await pool.end();
  });

  describe('isBlackoutCleared', () => {
    it("clears a global admin's account", async () => {
      expect(await isBlackoutCleared(accounts.admin)).toBe(true);
    });

    it('clears the whole account of a character granted by name', async () => {
      // Clearance is keyed by account, so NAMED_ALT sees through NAMED_CHAR's grant.
      expect(await isBlackoutCleared(accounts.named)).toBe(true);
    });

    it("clears a title holder's account", async () => {
      expect(await isBlackoutCleared(accounts.title)).toBe(true);
    });

    it('ignores expired by-name and title grants', async () => {
      expect(await isBlackoutCleared(accounts.expired)).toBe(false);
    });

    it("ignores a kicked character's by-name grant", async () => {
      expect(await isBlackoutCleared(accounts.kicked)).toBe(false);
    });

    it("ignores a banned character's title", async () => {
      expect(await isBlackoutCleared(accounts.banned)).toBe(false);
    });

    it('does not clear an unrelated account', async () => {
      expect(await isBlackoutCleared(accounts.plain)).toBe(false);
    });
  });

  describe('cleared-list constraints', () => {
    it('rejects a blackout_view grant on a corporation', async () => {
      expect(await insertViolation(blackoutGrant('corporation', OUTSIDE_CORP))).toBe(
        'ap_access_grant_blackout_principal_chk',
      );
    });

    it('rejects a blackout_view grant on an alliance', async () => {
      expect(await insertViolation(blackoutGrant('alliance', OUTSIDE_ALLIANCE))).toBe(
        'ap_access_grant_blackout_principal_chk',
      );
    });

    it('still admits login grants on a corporation', async () => {
      expect(
        await insertViolation({ ...blackoutGrant('corporation', OUTSIDE_CORP), capability: 'login' }),
      ).toBeNull();
    });
  });

  describe('login gate', () => {
    beforeAll(async () => {
      // Restricted with an owner seeded, so the bootstrap path is off.
      await db
        .insert(apInstance)
        .values({ id: 1, accessMode: 'restricted' })
        .onConflictDoUpdate({ target: apInstance.id, set: { accessMode: 'restricted' } });
      await db
        .insert(apInstanceOwner)
        .values({ principalKind: 'corporation', principalId: OWNER_CORP })
        .onConflictDoNothing();
    });

    it('does not admit a character whose only grant is blackout_view', async () => {
      expect(
        await isLoginAllowed({
          characterId: LOGIN_PROBE_CHAR,
          corporationId: PROBE_CORP,
          allianceId: null,
        }),
      ).toBe(false);
    });
  });

  describe('getBlackoutState', () => {
    it('reads off while blackout_since is NULL', async () => {
      await setSwitch(null, null);
      expect(await getBlackoutState()).toEqual({ active: false, since: null, byCharacterId: null });
    });

    it('reads on with since and by while blackout_since is set', async () => {
      const since = new Date('2026-10-17T12:00:00Z');
      await setSwitch(since, ADMIN_CHAR);
      expect(await getBlackoutState()).toEqual({ active: true, since, byCharacterId: ADMIN_CHAR });
    });

    it('stays on with no attribution once the admin who turned it on is erased', async () => {
      const since = new Date('2026-10-17T12:00:00Z');
      await setSwitch(since, PLAIN_CHAR);
      await db.delete(apCharacter).where(eq(apCharacter.id, PLAIN_CHAR));
      expect(await getBlackoutState()).toEqual({ active: true, since, byCharacterId: null });
    });
  });
});

// ─── helpers ───────────────────────────────────────────────────────────────

type CharOverrides = {
  authzLevel?: 'member' | 'admin';
  status?: 'active' | 'kicked' | 'banned';
};

function mkChar(id: bigint, userId: number, overrides: CharOverrides = {}) {
  return {
    id,
    userId,
    name: `Blackout ${id.toString()}`,
    ownerHash: `blackout-hash-${id.toString()}`,
    authzLevel: overrides.authzLevel ?? 'member',
    corporationId: CORP,
    allianceId: null,
    status: overrides.status ?? 'active',
  };
}

function blackoutGrant(
  principalKind: 'character' | 'corporation' | 'alliance' | 'role',
  principalId: bigint,
  expiresAt: Date | null = null,
) {
  return {
    principalKind,
    principalId,
    scope: 'instance' as const,
    mapId: null,
    capability: 'blackout_view' as 'blackout_view' | 'login',
    expiresAt,
  };
}

/** Insert a grant; return the violated constraint's name, or null on success. */
async function insertViolation(values: ReturnType<typeof blackoutGrant>): Promise<string | null> {
  try {
    await db.insert(apAccessGrant).values(values);
    return null;
  } catch (err) {
    const cause = (err as { cause?: { constraint?: string } }).cause;
    return cause?.constraint ?? (err as { constraint?: string }).constraint ?? 'unknown';
  }
}

async function setSwitch(since: Date | null, byCharacterId: bigint | null) {
  await db
    .update(apInstance)
    .set({ blackoutSince: since, blackoutByCharacterId: byCharacterId })
    .where(eq(apInstance.id, 1));
}

async function cleanup() {
  await db
    .delete(apAccessGrant)
    .where(
      and(
        inArray(apAccessGrant.principalKind, ['character', 'role']),
        inArray(apAccessGrant.principalId, [...characterIds, ...roleIds]),
      ),
    );
  await db
    .delete(apAccessGrant)
    .where(
      and(
        inArray(apAccessGrant.principalKind, ['corporation', 'alliance']),
        inArray(apAccessGrant.principalId, orgIds),
      ),
    );
  await db
    .delete(apInstanceOwner)
    .where(
      and(eq(apInstanceOwner.principalKind, 'corporation'), eq(apInstanceOwner.principalId, OWNER_CORP)),
    );
  await db.delete(apCharacterRole).where(inArray(apCharacterRole.characterId, characterIds));
  await db.delete(apRole).where(inArray(apRole.id, roleIds));
  const users = await db
    .select({ userId: apCharacter.userId })
    .from(apCharacter)
    .where(inArray(apCharacter.id, characterIds));
  await db.delete(apCharacter).where(inArray(apCharacter.id, characterIds));
  const userIds = [...new Set([...users.map((u) => u.userId), ...Object.values(accounts)])].filter(
    (id) => id !== 0,
  );
  if (userIds.length > 0) await db.delete(apUser).where(inArray(apUser.id, userIds));
  await db.delete(apCorporation).where(eq(apCorporation.id, CORP));
}
