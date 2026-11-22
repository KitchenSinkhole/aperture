import 'server-only';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { apCharacter, apUser } from '@/db/schema';
import { isUserApiAccountBlocked } from '@/lib/userApi/authorize';
import type { UserApiAccountBlock } from '@/types';

/**
 * Row shape returned by `listAdminMembers`. Mirrors the `ap_character` columns
 * the `/admin/members` table renders plus the derived fields the action menu
 * needs to decide which controls to show (`status`, `authzLevel`).
 */
export type AdminMemberRow = {
  id: string;
  name: string;
  corporationId: string | null;
  allianceId: string | null;
  status: 'active' | 'kicked' | 'banned';
  statusExpiresAt: string | null;
  statusReason: string | null;
  statusChangedAt: string | null;
  authzLevel: 'member' | 'admin';
  lastOnline: boolean | null;
  lastLocationAt: string | null;
  /** The owning account's standing user API block; null when not blocked. */
  apiBlock: UserApiAccountBlock | null;
};

/**
 * Every `ap_character` the `/admin` operator console can act on. `/admin` is
 * global-admin-only, so this is unscoped — it returns all characters.
 *
 * Ordering puts non-active rows first (banned, then kicked, then active) so
 * the admin sees actionable moderation state at the top of the table, then
 * alphabetises within each band.
 */
export async function listAdminMembers(): Promise<AdminMemberRow[]> {
  const rows = await db
    .select({
      id: apCharacter.id,
      name: apCharacter.name,
      corporationId: apCharacter.corporationId,
      allianceId: apCharacter.allianceId,
      status: apCharacter.status,
      statusExpiresAt: apCharacter.statusExpiresAt,
      statusReason: apCharacter.statusReason,
      statusChangedAt: apCharacter.statusChangedAt,
      authzLevel: apCharacter.authzLevel,
      lastOnline: apCharacter.lastOnline,
      lastLocationAt: apCharacter.lastLocationAt,
      apiBlockedAt: apUser.apiBlockedAt,
      apiBlockedUntil: apUser.apiBlockedUntil,
      apiBlockReason: apUser.apiBlockReason,
    })
    .from(apCharacter)
    .innerJoin(apUser, eq(apUser.id, apCharacter.userId))
    .orderBy(asc(apCharacter.status), asc(apCharacter.name));

  const now = new Date();
  return rows.map((r) => ({
    id: r.id.toString(),
    name: r.name,
    corporationId: r.corporationId === null ? null : r.corporationId.toString(),
    allianceId: r.allianceId === null ? null : r.allianceId.toString(),
    status: r.status,
    statusExpiresAt: r.statusExpiresAt === null ? null : r.statusExpiresAt.toISOString(),
    statusReason: r.statusReason,
    statusChangedAt: r.statusChangedAt === null ? null : r.statusChangedAt.toISOString(),
    authzLevel: r.authzLevel,
    lastOnline: r.lastOnline,
    lastLocationAt: r.lastLocationAt === null ? null : r.lastLocationAt.toISOString(),
    apiBlock: isUserApiAccountBlocked(r, now)
      ? { reason: r.apiBlockReason, until: r.apiBlockedUntil?.toISOString() ?? null }
      : null,
  }));
}
