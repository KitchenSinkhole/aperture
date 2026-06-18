import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { apCharacter, apUser } from '@/db/schema';
import { encryptToken } from '@/lib/crypto';
import type { EveProfile } from '@/lib/auth/eve-provider';

/**
 * Upsert the user + character on initial sign-in and store the (encrypted) ESI
 * tokens. Resolution of the owning `ap_user`:
 * - An unseen character with a valid `linkUserId` (the "Add character" flow) is
 *   attached to that account; without a link a fresh `ap_user` is minted.
 * - An already-seen character with a `linkUserId` that differs from its current
 *   account is **re-homed** onto the linking account (the "Add character" flow,
 *   issue #116). If this empties the old account it is deleted (absorbed); if the
 *   old account keeps other characters but its main was the moved character, the
 *   main is repointed to a remaining one. Re-homing is authorized by the fresh
 *   SSO proof of control over the character plus the `signIn` login gate.
 * - Otherwise the character keeps its existing `user_id`.
 * Runs in a transaction so the re-home and old-account cleanup are atomic.
 * Returns the resolved `userId`.
 *
 * Lives in its own module (not `@/lib/auth`) so it is importable without pulling
 * in the NextAuth construction, which only resolves inside the Next bundler.
 */
export async function persistLogin(
  profile: EveProfile,
  tokens: { accessToken: string; refreshToken: string; expiresAt: number },
  linkUserId?: number | null,
): Promise<number> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ userId: apCharacter.userId })
      .from(apCharacter)
      .where(eq(apCharacter.id, profile.characterId));

    const existingUserId = existing?.userId; // undefined ⇒ brand-new character
    let userId: number;
    let rehomedFrom: number | null = null; // old account to clean up afterwards

    if (existingUserId === undefined) {
      if (linkUserId != null) {
        userId = linkUserId;
      } else {
        const [user] = await tx.insert(apUser).values({}).returning({ id: apUser.id });
        userId = user!.id;
      }
    } else if (linkUserId != null && linkUserId !== existingUserId) {
      userId = linkUserId;
      rehomedFrom = existingUserId;
    } else {
      userId = existingUserId;
    }

    const values = {
      id: profile.characterId,
      userId,
      name: profile.name,
      ownerHash: profile.ownerHash,
      esiAccessToken: encryptToken(tokens.accessToken),
      esiRefreshToken: encryptToken(tokens.refreshToken),
      esiAccessTokenExpires: new Date(tokens.expiresAt * 1000),
      esiScopes: profile.scopes,
      updatedAt: new Date(),
    };
    await tx
      .insert(apCharacter)
      .values(values)
      .onConflictDoUpdate({ target: apCharacter.id, set: values });

    if (rehomedFrom != null) {
      const remaining = await tx
        .select({ id: apCharacter.id })
        .from(apCharacter)
        .where(eq(apCharacter.userId, rehomedFrom))
        .orderBy(apCharacter.id);
      if (remaining.length === 0) {
        // Old account emptied by the move — absorb it. FK cascades clear its
        // per-account rows; audit `character_id`s are already on the moved char.
        await tx.delete(apUser).where(eq(apUser.id, rehomedFrom));
      } else {
        // Old account survives. If its main left with the moved character, repoint
        // it to a remaining one so its main/stats stay valid without a re-login.
        await tx
          .update(apUser)
          .set({ mainCharacterId: remaining[0]!.id, updatedAt: new Date() })
          .where(
            and(eq(apUser.id, rehomedFrom), eq(apUser.mainCharacterId, profile.characterId)),
          );
      }
    }

    return userId;
  });
}
