// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, inArray } from 'drizzle-orm';
import type { Session } from 'next-auth';
import { db, pool } from '@/db/client';
import { apCharacter, apUser } from '@/db/schema';
import { DEFAULT_SOUND_PREFS } from '@/lib/sounds/prefs';
import type { SoundPrefs } from '@/types';

/**
 * Audio-cue preferences — the `ap_user.sound_prefs` round trip (real Postgres).
 *
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test
 */
const run = process.env.RUN_DB_TESTS === '1';

let currentSession: Session | null = null;
vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => currentSession) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { setSoundPrefsAction } = await import('@/app/(app)/actions/account');
const { getSoundPrefs } = await import('@/lib/session');

const CHARACTER_ID = 96009101n;
const characterIds = [CHARACTER_ID];

let userId = 0;

function asSession(characterId: bigint): Session {
  return {
    characterId: characterId.toString(),
    userId,
    user: { id: String(userId) },
  } as unknown as Session;
}

const VALID_PREFS: SoundPrefs = {
  enabled: true,
  volume: 0.4,
  events: {
    pilotArrived: { enabled: true, sound: 'tick' },
    pilotLeft: { enabled: false, sound: 'chime-down' },
    watchedJump: { enabled: true, sound: 'alarm' },
    killInSystem: { enabled: false, sound: 'alarm' },
    rallySet: { enabled: true, sound: 'bell' },
    systemPinged: { enabled: false, sound: 'ping' },
  },
};

describe.skipIf(!run)('sound preferences persistence (real Postgres)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    await cleanup();

    const [u] = await db.insert(apUser).values({}).returning({ id: apUser.id });
    userId = u!.id;

    await db.insert(apCharacter).values({
      id: CHARACTER_ID,
      userId,
      name: 'Sound Pilot',
      ownerHash: `hash-${CHARACTER_ID.toString()}`,
    });
  });

  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  beforeEach(async () => {
    currentSession = null;
    await db.update(apUser).set({ soundPrefs: null }).where(eq(apUser.id, userId));
  });

  it('a fresh account resolves to the defaults', async () => {
    expect(await getSoundPrefs(userId)).toEqual(DEFAULT_SOUND_PREFS);
  });

  it('accepts a valid blob and reads it back unchanged', async () => {
    currentSession = asSession(CHARACTER_ID);
    expect(await setSoundPrefsAction(VALID_PREFS)).toEqual({ ok: true });
    expect(await getSoundPrefs(userId)).toEqual(VALID_PREFS);
  });

  it('rejects a malformed blob and leaves the column untouched', async () => {
    currentSession = asSession(CHARACTER_ID);
    await setSoundPrefsAction(VALID_PREFS);

    for (const bad of [
      null,
      'off',
      { enabled: true, volume: 0.5 },
      { ...VALID_PREFS, volume: 4 },
      {
        ...VALID_PREFS,
        events: { ...VALID_PREFS.events, pilotArrived: { enabled: true, sound: 'foghorn' } },
      },
    ]) {
      const res = await setSoundPrefsAction(bad);
      expect(res.ok).toBe(false);
    }

    expect(await getSoundPrefs(userId)).toEqual(VALID_PREFS);
  });

  it('repairs a stored blob naming a sound this build does not know', async () => {
    await db
      .update(apUser)
      .set({
        soundPrefs: {
          ...VALID_PREFS,
          events: {
            ...VALID_PREFS.events,
            pilotArrived: { enabled: true, sound: 'voice-arrived' },
          },
        } as unknown as SoundPrefs,
      })
      .where(eq(apUser.id, userId));

    const prefs = await getSoundPrefs(userId);
    expect(prefs.events.pilotArrived).toEqual({
      enabled: true,
      sound: DEFAULT_SOUND_PREFS.events.pilotArrived.sound,
    });
  });
});

async function cleanup() {
  await db.delete(apCharacter).where(inArray(apCharacter.id, characterIds));
  if (userId) {
    await db.delete(apUser).where(eq(apUser.id, userId));
    userId = 0;
  }
}
