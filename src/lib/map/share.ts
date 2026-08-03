// NOTE: deliberately no `import 'server-only'` — Stage 5 imports this module
// from `src/lib/realtime/wsServer.ts`, which runs in the custom Node entry
// (tsx) without Next.js's `react-server` resolver condition. Under plain Node
// the `server-only` default export throws on load. Every caller is
// server-side (API routes, the public loader, the WS upgrade handler); we
// rely on that rather than the marker package.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import { db } from '@/db/client';
import { apMap, apMapShare } from '@/db/schema';
import { closePublicSocketsForToken } from '@/lib/realtime/publicSockets';
import type { ShareRedactionProfile } from '@/types';

/** A fresh, URL-safe share token — 128 bits of entropy, 22 base64url chars. */
export function generateShareToken(): string {
  return randomBytes(16).toString('base64url');
}

export interface ResolvedShareToken {
  shareId: bigint;
  mapId: bigint;
  label: string;
  profile: ShareRedactionProfile;
}

/**
 * Resolves a raw share token to its map id and redaction profile, or `null`
 * if the token is unknown, expired, revoked, or its parent map is
 * soft-deleted. Every failure path returns the same bare `null` — callers
 * must not distinguish "no such token" from "revoked" in status code or
 * timing, matching `resolveIntegrationToken`'s discipline
 * (`src/lib/integrations/token.ts`).
 */
export async function resolveShareToken(token: string): Promise<ResolvedShareToken | null> {
  if (!token) return null;

  const now = new Date();
  const [row] = await db
    .select({
      shareId: apMapShare.id,
      mapId: apMapShare.mapId,
      token: apMapShare.token,
      label: apMapShare.label,
      presenceMode: apMapShare.presenceMode,
      showSignatures: apMapShare.showSignatures,
      showKillStats: apMapShare.showKillStats,
      showConnectionSigIds: apMapShare.showConnectionSigIds,
    })
    .from(apMapShare)
    .innerJoin(apMap, eq(apMap.id, apMapShare.mapId))
    .where(
      and(
        eq(apMapShare.token, token),
        isNull(apMapShare.revokedAt),
        or(isNull(apMapShare.expiresAt), gt(apMapShare.expiresAt, now)),
        isNull(apMap.deletedAt),
      ),
    );
  if (!row) return null;

  // Constant-time confirmation of the indexed lookup, matching the
  // `/api/integrations` comparison discipline.
  const a = Buffer.from(token);
  const b = Buffer.from(row.token);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  return {
    shareId: row.shareId,
    mapId: row.mapId,
    label: row.label,
    profile: {
      presenceMode: row.presenceMode,
      showSignatures: row.showSignatures,
      showKillStats: row.showKillStats,
      showConnectionSigIds: row.showConnectionSigIds,
    },
  };
}

/**
 * Revokes a share by id: sets `revoked_at` (idempotent — a share already
 * revoked is left alone and returns `null`) and closes every live public
 * socket pinned to its token. Does not invalidate the snapshot cache
 * (`publicSnapshot.ts` is `server-only` and unreachable from here); the
 * cache's short TTL means the page 404s within one window regardless.
 */
export async function revokeShareToken(shareId: bigint): Promise<string | null> {
  const [row] = await db
    .update(apMapShare)
    .set({ revokedAt: new Date() })
    .where(and(eq(apMapShare.id, shareId), isNull(apMapShare.revokedAt)))
    .returning({ token: apMapShare.token });
  if (!row) return null;

  closePublicSocketsForToken(row.token);
  return row.token;
}
