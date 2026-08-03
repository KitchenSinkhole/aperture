'use server';

import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { apMapShare } from '@/db/schema';
import { sharePresenceMode } from '@/db/schema/ap/enums';
import { canUseMapFeature } from '@/lib/auth/rights';
import { commitMapEvent } from '@/lib/map/mutations/core';
import { generateShareToken, listMapShares, revokeShareToken } from '@/lib/map/share';
import { requireSession } from '@/lib/session';
import type { MapShareListItem } from '@/types';

/**
 * Server Actions behind the in-map Settings → Share links tab: mint, list, and
 * revoke the public `/live/<token>` links for one map. Every action gates on
 * `canUseMapFeature(characterId, mapId, 'share_manage')` — a manager implicitly,
 * or a corp title delegated the capability.
 *
 * A share's redaction profile is fixed at mint. Changing what a link exposes
 * means revoking it and issuing a new one, so a URL already in circulation can
 * never widen its disclosure under the recipient.
 *
 * Mint and revoke each land as one `ap_map_event` (`share.created` /
 * `share.revoked`) naming the label and, on mint, the profile — so publishing
 * the chain is visible in the map audit log and Discord history. The token
 * itself never enters the payload: that envelope reaches every viewer and the
 * webhook, and the token is a capability URL. The tab refetches `listShares`
 * after each mutation, so there is no `revalidatePath`.
 */

const mapIdSchema = z.string().regex(/^\d+$/, 'Invalid map id.');
const shareIdSchema = z.string().regex(/^\d+$/, 'Invalid share id.');

/** One year — a public link that outlives the chain it charts is an accident, not a plan. */
const MAX_EXPIRY_HOURS = 24 * 365;

type ActionResult<T = void> =
  | (T extends void ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string };

async function gate(mapId: bigint): Promise<bigint | null> {
  const session = await requireSession();
  const characterId = BigInt(session.characterId);
  return (await canUseMapFeature(characterId, mapId, 'share_manage')) ? characterId : null;
}

/**
 * The map's non-revoked share links, newest first. Includes each raw token so
 * the panel can offer a copy-link button.
 */
export async function listShares(mapId: string): Promise<ActionResult<MapShareListItem[]>> {
  const parsed = mapIdSchema.safeParse(mapId);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  const id = BigInt(parsed.data);

  if (!(await gate(id))) return { ok: false, error: 'Forbidden.' };
  return { ok: true, data: await listMapShares(id) };
}

const createSchema = z.object({
  mapId: mapIdSchema,
  label: z.string().trim().min(1, 'Label is required.').max(60, 'Label is too long.'),
  presenceMode: z.enum(sharePresenceMode.enumValues),
  showSignatures: z.boolean(),
  showConnectionSigIds: z.boolean(),
  /** Hours from now, resolved server-side so a skewed client clock can't extend a link. */
  expiresInHours: z.number().int().positive().max(MAX_EXPIRY_HOURS).nullable(),
});

/** Mint a share link. */
export async function createMapShare(
  input: z.input<typeof createSchema>,
): Promise<ActionResult<{ token: string }>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  const mapId = BigInt(parsed.data.mapId);
  const { label, presenceMode, showSignatures, showConnectionSigIds, expiresInHours } = parsed.data;

  const actorId = await gate(mapId);
  if (!actorId) return { ok: false, error: 'Forbidden.' };

  const token = generateShareToken();
  const expiresAt =
    expiresInHours === null ? null : new Date(Date.now() + expiresInHours * 3_600_000);

  const result = await commitMapEvent({
    mapId,
    characterId: actorId,
    kind: 'share.created',
    mutate: async (tx) => {
      const [row] = await tx
        .insert(apMapShare)
        .values({
          mapId,
          token,
          label,
          presenceMode,
          showSignatures,
          showConnectionSigIds,
          expiresAt,
          createdByCharacterId: actorId,
        })
        .returning({ id: apMapShare.id });
      return {
        shareId: row!.id.toString(),
        label,
        presenceMode,
        showSignatures,
        showConnectionSigIds,
        expiresAt: expiresAt?.toISOString() ?? null,
      };
    },
  });

  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, data: { token } };
}

/**
 * Kill a share link: `revoked_at` is set and every live public socket pinned to
 * the token is closed. Idempotent — revoking an already-dead share succeeds
 * without a second audit entry.
 */
export async function revokeMapShare(shareId: string): Promise<ActionResult> {
  const parsed = shareIdSchema.safeParse(shareId);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  const id = BigInt(parsed.data);

  const [share] = await db
    .select({ mapId: apMapShare.mapId, label: apMapShare.label })
    .from(apMapShare)
    .where(eq(apMapShare.id, id));
  // Same message whether the id is unknown or on a map the actor can't manage:
  // share ids are sequential, so a distinct "forbidden" would let any signed-in
  // character enumerate which maps have live links.
  if (!share) return { ok: false, error: 'Share link not found.' };

  const actorId = await gate(share.mapId);
  if (!actorId) return { ok: false, error: 'Share link not found.' };

  // Cut access first: if the audit insert then fails, the link is still dead,
  // which is the safe direction to fail in.
  if ((await revokeShareToken(id)) === null) return { ok: true };

  const result = await commitMapEvent({
    mapId: share.mapId,
    characterId: actorId,
    kind: 'share.revoked',
    mutate: async () => ({ shareId: id.toString(), label: share.label }),
  });

  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true };
}
