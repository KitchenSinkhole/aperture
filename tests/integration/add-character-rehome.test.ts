// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, inArray } from 'drizzle-orm';
import { db, pool } from '@/db/client';
import { apCharacter, apUser } from '@/db/schema';
import { persistLogin } from '@/lib/auth/persistLogin';
import type { EveProfile } from '@/lib/auth/eve-provider';

// Issue #116 — "Add character" must re-home an alt that already owns its own
// account onto the linking account (absorbing the now-empty old account), rather
// than logging you into the alt's account.

const A = 90000210n; // main of the linking account
const B = 90000211n; // the alt being re-homed
const C = 90000212n; // sibling that keeps the old account alive
const NEW = 90000213n; // brand-new character
const D = 90000214n; // already-seen character logging in without a link

const TEST_IDS = [A, B, C, NEW, D];
const createdUserIds = new Set<number>();

function profile(characterId: bigint, name: string): EveProfile {
  return { characterId, name, ownerHash: `hash-${characterId}`, scopes: ['publicData'] };
}

const tokens = () => ({
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresAt: Math.floor(Date.now() / 1000) + 1200,
});

async function newAccount(): Promise<number> {
  const [u] = await db.insert(apUser).values({}).returning({ id: apUser.id });
  createdUserIds.add(u!.id);
  return u!.id;
}

async function userIdOf(characterId: bigint): Promise<number | null> {
  const [row] = await db
    .select({ userId: apCharacter.userId })
    .from(apCharacter)
    .where(eq(apCharacter.id, characterId));
  return row?.userId ?? null;
}

async function accountExists(userId: number): Promise<boolean> {
  const [row] = await db.select({ id: apUser.id }).from(apUser).where(eq(apUser.id, userId));
  return row !== undefined;
}

async function cleanup() {
  await db.delete(apCharacter).where(inArray(apCharacter.id, TEST_IDS));
  if (createdUserIds.size > 0) {
    await db.delete(apUser).where(inArray(apUser.id, [...createdUserIds]));
    createdUserIds.clear();
  }
}

describe('add-character re-home (real Postgres)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
  });

  beforeEach(cleanup);

  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  it('re-homes the alt and deletes the emptied old account', async () => {
    const linkAccount = await newAccount();
    await db.insert(apCharacter).values({ id: A, userId: linkAccount, name: 'Main', ownerHash: 'hA' });
    await db.update(apUser).set({ mainCharacterId: A }).where(eq(apUser.id, linkAccount));

    const oldAccount = await newAccount();
    await db.insert(apCharacter).values({ id: B, userId: oldAccount, name: 'Alt', ownerHash: 'hB' });
    await db.update(apUser).set({ mainCharacterId: B }).where(eq(apUser.id, oldAccount));

    const resolved = await persistLogin(profile(B, 'Alt'), tokens(), linkAccount);

    expect(resolved).toBe(linkAccount);
    expect(await userIdOf(B)).toBe(linkAccount);
    expect(await accountExists(oldAccount)).toBe(false); // absorbed
  });

  it('re-homes the alt, keeps a surviving old account, and repoints its stale main', async () => {
    const linkAccount = await newAccount();
    await db.insert(apCharacter).values({ id: A, userId: linkAccount, name: 'Main', ownerHash: 'hA' });
    await db.update(apUser).set({ mainCharacterId: A }).where(eq(apUser.id, linkAccount));

    const oldAccount = await newAccount();
    await db.insert(apCharacter).values([
      { id: B, userId: oldAccount, name: 'Alt', ownerHash: 'hB' },
      { id: C, userId: oldAccount, name: 'Sibling', ownerHash: 'hC' },
    ]);
    await db.update(apUser).set({ mainCharacterId: B }).where(eq(apUser.id, oldAccount));

    await persistLogin(profile(B, 'Alt'), tokens(), linkAccount);

    expect(await userIdOf(B)).toBe(linkAccount);
    expect(await userIdOf(C)).toBe(oldAccount); // sibling stays
    expect(await accountExists(oldAccount)).toBe(true);
    const [old] = await db
      .select({ main: apUser.mainCharacterId })
      .from(apUser)
      .where(eq(apUser.id, oldAccount));
    expect(old!.main).toBe(C); // stale main repointed off the moved character
  });

  it('attaches a brand-new character to the linking account without minting one', async () => {
    const linkAccount = await newAccount();

    const resolved = await persistLogin(profile(NEW, 'Fresh'), tokens(), linkAccount);

    expect(resolved).toBe(linkAccount);
    expect(await userIdOf(NEW)).toBe(linkAccount);
  });

  it('leaves an already-seen character on its account when there is no link', async () => {
    const ownAccount = await newAccount();
    await db.insert(apCharacter).values({ id: D, userId: ownAccount, name: 'Solo', ownerHash: 'hD' });
    await db.update(apUser).set({ mainCharacterId: D }).where(eq(apUser.id, ownAccount));

    const resolved = await persistLogin(profile(D, 'Solo'), tokens(), null);

    expect(resolved).toBe(ownAccount);
    expect(await userIdOf(D)).toBe(ownAccount);
    expect(await accountExists(ownAccount)).toBe(true);
  });

  it('reattributes the re-homed alt to the linking account main (stats/audit join)', async () => {
    const linkAccount = await newAccount();
    await db.insert(apCharacter).values({ id: A, userId: linkAccount, name: 'Main', ownerHash: 'hA' });
    await db.update(apUser).set({ mainCharacterId: A }).where(eq(apUser.id, linkAccount));

    const oldAccount = await newAccount();
    await db.insert(apCharacter).values({ id: B, userId: oldAccount, name: 'Alt', ownerHash: 'hB' });
    await db.update(apUser).set({ mainCharacterId: B }).where(eq(apUser.id, oldAccount));

    await persistLogin(profile(B, 'Alt'), tokens(), linkAccount);

    // The audit/stats rollups resolve an event's owner via
    // character_id → ap_character.user_id → ap_user.main_character_id. After the
    // re-home that join must land B's history under the linking account's main (A).
    const [row] = await db
      .select({ main: apUser.mainCharacterId })
      .from(apCharacter)
      .innerJoin(apUser, eq(apUser.id, apCharacter.userId))
      .where(eq(apCharacter.id, B));
    expect(row!.main).toBe(A);
  });
});
