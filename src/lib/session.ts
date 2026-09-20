import 'server-only';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import type { Session } from 'next-auth';
import type {
  MapLayoutConfig,
  SignatureIndicatorAccountSettings,
  SignatureIndicatorPrefs,
} from '@/types';
import { auth } from '@/lib/auth';
import { db } from '@/db/client';
import { apCharacter, apInstance, apUser } from '@/db/schema';

// Server-only account/session helpers. Everything map- and chrome-level reads
// the active character and the account's character roster through here so the
// ownership rule lives in exactly one place. Sessions are stateless JWT.

export type AccountCharacter = {
  id: string;
  name: string;
  status: (typeof apCharacter.$inferSelect)['status'];
  authzLevel: (typeof apCharacter.$inferSelect)['authzLevel'];
};

/** The current Auth.js session, or `null` when logged out. */
export async function getSession(): Promise<Session | null> {
  return auth();
}

/**
 * The current session; `redirect('/')` to the public splash when absent **or**
 * when the active character's `status !== 'active'` (kicked / banned
 * characters lose every gated route on their next request, not just
 * the next sign-in).
 */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session?.characterId) redirect('/');
  const [row] = await db
    .select({ status: apCharacter.status })
    .from(apCharacter)
    .where(eq(apCharacter.id, BigInt(session.characterId)));
  if (row === undefined || row.status !== 'active') redirect('/');
  return session;
}

/** The full `ap_character` row for the active character, or `null`. */
export async function getActiveCharacter() {
  const session = await getSession();
  if (!session?.characterId) return null;
  const [row] = await db
    .select()
    .from(apCharacter)
    .where(eq(apCharacter.id, BigInt(session.characterId)));
  return row ?? null;
}

/**
 * Every character on the account, ordered by name. Returns only display-safe
 * fields — ESI tokens never leave the DB layer.
 */
export async function getAccountCharacters(userId: number): Promise<AccountCharacter[]> {
  const rows = await db
    .select({
      id: apCharacter.id,
      name: apCharacter.name,
      status: apCharacter.status,
      authzLevel: apCharacter.authzLevel,
    })
    .from(apCharacter)
    .where(eq(apCharacter.userId, userId))
    .orderBy(apCharacter.name);
  return rows.map((r) => ({ ...r, id: r.id.toString() }));
}

/**
 * The account's main character id as a string (bigint isn't JSON-safe), or
 * `null` when unset. Drives the Account Settings "main" selector.
 */
export async function getMainCharacterId(userId: number): Promise<string | null> {
  const [row] = await db
    .select({ mainCharacterId: apUser.mainCharacterId })
    .from(apUser)
    .where(eq(apUser.id, userId));
  return row?.mainCharacterId != null ? row.mainCharacterId.toString() : null;
}

export async function getConnectionTravelAnimation(userId: number): Promise<boolean> {
  const [row] = await db
    .select({ enabled: apUser.connectionTravelAnimation })
    .from(apUser)
    .where(eq(apUser.id, userId));
  // Default on when the row is somehow missing — mirrors the column default.
  return row?.enabled ?? true;
}

/**
 * The account's stored map dashboard layout (map-layout-builder), or `null` when
 * unset — the client then falls back to `DEFAULT_MAP_LAYOUT`. One global layout
 * per account, applied to every map.
 */
export async function getMapLayout(userId: number): Promise<MapLayoutConfig | null> {
  const [row] = await db
    .select({ mapLayout: apUser.mapLayout })
    .from(apUser)
    .where(eq(apUser.id, userId));
  return row?.mapLayout ?? null;
}

const DEFAULT_STALE_THRESHOLD_MINUTES = 240;

/** The instance-wide default stale-signature threshold (minutes). */
export async function getGlobalStaleThresholdMinutes(): Promise<number> {
  const [row] = await db
    .select({ minutes: apInstance.staleSignatureThresholdMinutes })
    .from(apInstance)
    .where(eq(apInstance.id, 1));
  return row?.minutes ?? DEFAULT_STALE_THRESHOLD_MINUTES;
}

/**
 * The account's *resolved* signature-indicator preferences for client rendering:
 * the effective threshold (user override already capped to the global default)
 * plus the two on/off toggles. A missing override falls back to the global.
 */
export async function getSignatureIndicatorPrefs(
  userId: number,
): Promise<SignatureIndicatorPrefs> {
  const [global, [user]] = await Promise.all([
    getGlobalStaleThresholdMinutes(),
    db
      .select({
        override: apUser.staleSignatureThresholdMinutes,
        showStale: apUser.showStaleSignatureIndicator,
        showUnscanned: apUser.showUnscannedSignatureIndicator,
      })
      .from(apUser)
      .where(eq(apUser.id, userId)),
  ]);
  const override = user?.override ?? null;
  // Defensive cap: the write action already enforces this, but never trust a row.
  const thresholdMinutes = override != null ? Math.min(override, global) : global;
  return {
    thresholdMinutes,
    showStale: user?.showStale ?? true,
    showUnscanned: user?.showUnscanned ?? true,
  };
}

/** Raw values for the Account Settings dialog (the global cap + the user's own). */
export async function getSignatureIndicatorAccountSettings(
  userId: number,
): Promise<SignatureIndicatorAccountSettings> {
  const [globalThresholdMinutes, [user]] = await Promise.all([
    getGlobalStaleThresholdMinutes(),
    db
      .select({
        override: apUser.staleSignatureThresholdMinutes,
        showStale: apUser.showStaleSignatureIndicator,
        showUnscanned: apUser.showUnscannedSignatureIndicator,
      })
      .from(apUser)
      .where(eq(apUser.id, userId)),
  ]);
  return {
    globalThresholdMinutes,
    userThresholdMinutes: user?.override ?? null,
    showStale: user?.showStale ?? true,
    showUnscanned: user?.showUnscanned ?? true,
  };
}

/**
 * Whether `characterId` belongs to `userId` and is currently `active`. The
 * single source of truth for the character-switch authorization check, reused
 * by the switch Server Action and (defensively) the jwt callback.
 */
export async function assertCharacterOwnership(
  characterId: bigint,
  userId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ status: apCharacter.status })
    .from(apCharacter)
    .where(and(eq(apCharacter.id, characterId), eq(apCharacter.userId, userId)));
  return row?.status === 'active';
}
