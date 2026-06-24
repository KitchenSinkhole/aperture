import NextAuth from 'next-auth';
import type {} from 'next-auth/jwt';
import { and, eq, isNull } from 'drizzle-orm';
import { apertureConfig } from '../../aperture.config';
import { db } from '@/db/client';
import { apCharacter, apUser } from '@/db/schema';
import { eveProvider, refreshAccessToken } from '@/lib/auth/eve-provider';
import type { EveProfile } from '@/lib/auth/eve-provider';
import { persistLogin } from '@/lib/auth/persistLogin';
import { clearLinkCookie, readLinkUserId } from '@/lib/auth/link-cookie';
import { isLoginAllowed } from '@/lib/auth/loginGate';
import { syncCharacterAuthz } from '@/lib/auth/syncCharacterAuthz';
import { seedTrackingForGainedAccess } from '@/lib/jobs/tracking';
import { AUTH_COOKIE_OPTIONS } from '@/lib/cookies';
import { fetchAffiliations } from '@/lib/esi/affiliation';

// Auth.js v5, stateless JWT sessions (no DB session store, no Redis).
// The JWT carries only the active character/user ids; ESI tokens never leave
// the DB row.

declare module 'next-auth' {
  interface Session {
    characterId: string;
    userId: number;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    characterId?: string;
    userId?: number;
    accessTokenExpiresAt?: number; // epoch seconds
    gateCheckedAt?: number; // epoch seconds — last login-eligibility re-check
  }
}

/**
 * Resolve the character the session should land on — the account's "main".
 * Every login lands on the main regardless of which character
 * actually SSO'd in; the human is one identity. On the first-ever login of an
 * account (or a pre-0018 account with no main yet) the authenticated character
 * is adopted as the main. A stored main that is no longer an active character
 * on the account falls back to the authenticated character.
 *
 * Implemented inline (not via `@/lib/session`) to avoid an import cycle —
 * `session.ts` already imports `auth` from here.
 */
async function resolveMainCharacter(
  userId: number,
  fallbackCharacterId: bigint,
): Promise<bigint> {
  const [user] = await db
    .select({ mainCharacterId: apUser.mainCharacterId })
    .from(apUser)
    .where(eq(apUser.id, userId));
  const stored = user?.mainCharacterId ?? null;
  if (stored == null) {
    // Bootstrap: guarded so concurrent first logins don't clobber each other.
    await db
      .update(apUser)
      .set({ mainCharacterId: fallbackCharacterId, updatedAt: new Date() })
      .where(and(eq(apUser.id, userId), isNull(apUser.mainCharacterId)));
    return fallbackCharacterId;
  }
  const [row] = await db
    .select({ id: apCharacter.id })
    .from(apCharacter)
    .where(
      and(
        eq(apCharacter.id, stored),
        eq(apCharacter.userId, userId),
        eq(apCharacter.status, 'active'),
      ),
    );
  return row ? stored : fallbackCharacterId;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [eveProvider()],
  session: { strategy: 'jwt' },
  // A denied sign-in (the `signIn` callback below returning false) redirects
  // here with `?error=AccessDenied` instead of the raw Auth.js error endpoint.
  pages: { error: '/access-denied' },
  // Make the cookie contract explicit at the call site rather than relying on
  // Auth.js defaults. Flags live in `@/lib/cookies` so any bespoke signed
  // cookie can read from the same constant.
  cookies: {
    sessionToken: { options: AUTH_COOKIE_OPTIONS },
    callbackUrl: { options: AUTH_COOKIE_OPTIONS },
    csrfToken: { options: AUTH_COOKIE_OPTIONS },
  },
  callbacks: {
    // The login gate — runs before `jwt`, so a
    // denial issues no session/JWT and `persistLogin`/`syncCharacterAuthz`
    // (below) never run: no `ap_character` row is created for a rejected sign-in.
    async signIn({ profile }) {
      if (!profile) return false;
      const eve = profile as unknown as EveProfile;
      const characterId = BigInt(eve.characterId);
      // The gate needs corp/alliance, which the SSO token claims don't carry.
      // Resolve them via the token-less ESI affiliation endpoint (cached ~1h, so
      // a pilot who just joined the owning corp gates in within the hour rather
      // than waiting out the ~24h public-profile cache).
      let corporationId: bigint | null = null;
      let allianceId: bigint | null = null;
      try {
        const affiliation = (await fetchAffiliations([characterId])).get(characterId);
        if (affiliation) {
          corporationId = affiliation.corporationId;
          allianceId = affiliation.allianceId;
        }
      } catch (err) {
        // ESI unreachable (downtime / breaker open / schema drift). Degrade to
        // character-level checks: explicit character grants and the bootstrap
        // path still admit known characters, while owner/corp/alliance-only
        // entitlements are denied until ESI recovers. Never fail open.
        console.warn(`[auth] login-gate affiliation fetch failed for ${characterId}:`, err);
      }
      return isLoginAllowed({ characterId, corporationId, allianceId });
    },
    async jwt({ token, account, profile }) {
      // Initial sign-in: `account` carries the freshly-exchanged tokens and
      // `profile` is the verified JWT-claims object from the provider.
      if (account && profile) {
        const eve = profile as unknown as EveProfile;
        const expiresAt = account.expires_at ?? Math.floor(Date.now() / 1000);
        // "Add character" flow: a signed cookie carries the account to link the
        // new character onto. Absent/forged/expired → fresh-account behavior.
        const linkUserId = await readLinkUserId();
        const userId = await persistLogin(
          eve,
          {
            accessToken: account.access_token as string,
            refreshToken: account.refresh_token as string,
            expiresAt,
          },
          linkUserId,
        );
        await clearLinkCookie();
        // Land on the account's main, not necessarily the character that SSO'd
        // in. The "add character" flow therefore returns you to your main after
        // registering the new alt — consistent with the model.
        const mainCharacterId = await resolveMainCharacter(userId, eve.characterId);
        token.characterId = mainCharacterId.toString();
        token.userId = userId;
        // The main may differ from the just-authenticated character, so read its
        // own token expiry rather than reusing the freshly-exchanged one.
        if (mainCharacterId === eve.characterId) {
          token.accessTokenExpiresAt = expiresAt;
        } else {
          const [mainRow] = await db
            .select({ exp: apCharacter.esiAccessTokenExpires })
            .from(apCharacter)
            .where(eq(apCharacter.id, mainCharacterId));
          token.accessTokenExpiresAt = mainRow?.exp
            ? Math.floor(mainRow.exp.getTime() / 1000)
            : expiresAt;
        }
        // Promote / demote authz, refresh affiliation, mirror corp
        // titles. Best-effort: ESI failure logs a warning but does not block
        // login — the user can still see the maps they already had access to.
        try {
          await syncCharacterAuthz(eve.characterId);
          // With fresh affiliation/authz cached, auto-track this character on
          // every already-seeded map it can now view — so a re-joining pilot or
          // a freshly-added alt lands tracked without waiting for the cron.
          await seedTrackingForGainedAccess(eve.characterId);
        } catch (err) {
          console.warn(
            `[auth] syncCharacterAuthz failed for character ${eve.characterId}:`,
            err,
          );
        }
        // The `signIn` gate just ran — stamp the re-gate clock so we don't
        // immediately re-check on the next request.
        token.gateCheckedAt = Math.floor(Date.now() / 1000);
        return token;
      }

      // Subsequent calls: rotate the access token as it nears expiry. The
      // rotation persists the new refresh token before returning (footgun #2).
      if (token.characterId && token.accessTokenExpiresAt) {
        const buffer = apertureConfig.SSO_TOKEN_REFRESH_BUFFER_S;
        if (Math.floor(Date.now() / 1000) >= token.accessTokenExpiresAt - buffer) {
          try {
            await refreshAccessToken(BigInt(token.characterId));
            const [row] = await db
              .select({ exp: apCharacter.esiAccessTokenExpires })
              .from(apCharacter)
              .where(eq(apCharacter.id, BigInt(token.characterId)));
            if (row?.exp) token.accessTokenExpiresAt = Math.floor(row.exp.getTime() / 1000);
          } catch {
            // Refresh failed (revoked token / CCP downtime). Leave the token as
            // is; downstream callers treat a stale character as logged-out.
          }
        }
      }

      // Re-gate the session against the login allowlist. A pilot who leaves the
      // owning corp/alliance (or is kicked/banned) keeps a valid JWT until this
      // runs; throttled to LOGIN_REGATE_INTERVAL_S so the hot path stays cheap.
      // Reads the freshly-synced corp/alliance from `ap_character` — the
      // `character-cleanup` affiliation sweep keeps it current — so no ESI here.
      // Returning `null` invalidates the session; the next navigation lands on
      // `/access-denied`.
      if (token.characterId) {
        const now = Math.floor(Date.now() / 1000);
        if (now - (token.gateCheckedAt ?? 0) >= apertureConfig.LOGIN_REGATE_INTERVAL_S) {
          const characterId = BigInt(token.characterId);
          const [row] = await db
            .select({
              status: apCharacter.status,
              corporationId: apCharacter.corporationId,
              allianceId: apCharacter.allianceId,
            })
            .from(apCharacter)
            .where(eq(apCharacter.id, characterId));
          if (!row || row.status !== 'active') return null;
          const allowed = await isLoginAllowed({
            characterId,
            corporationId: row.corporationId,
            allianceId: row.allianceId,
          });
          if (!allowed) return null;
          token.gateCheckedAt = now;
        }
      }
      return token;
    },
    async session({ session, token }) {
      return {
        ...session,
        characterId: token.characterId ?? '',
        userId: token.userId ?? 0,
      };
    },
  },
});
