'use server';

import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { apMap, apMapRoleAccess, apRole } from '@/db/schema';
import { mapCapability } from '@/db/schema/ap/enums';
import { canManageMap } from '@/lib/auth/rights';
import { commitMapEvent } from '@/lib/map/mutations/core';
import { requireSession } from '@/lib/session';
import type { DelegationRole, MapDelegationState } from '@/types';

/**
 * Per-title feature delegation for a corp map's Roles & Permissions tab (R4).
 * Both actions are gated by `canManageMap` — delegating a feature is itself a
 * management act, never something a delegated title-holder can do. A grant is
 * one `(map_id, role_id, capability)` row in `ap_map_role_access`; `view` is the
 * implicit visibility overlay and is never toggled here (any feature grant
 * already implies view).
 *
 * Delegation is a corp-map feature in v1 — the model (`role_id → capability`) is
 * corp-agnostic, so alliance support later adds only title eligibility for
 * alliance maps and cross-member-corp title resolution. Private/alliance maps
 * report `{ available: false }`.
 *
 * Each grant/revoke lands as one `ap_map_event` (`access.granted`/
 * `access.revoked`) via `commitMapEvent`, so delegation shows in the map audit
 * log naming the title and capability. The tab refetches `getMapDelegationState`
 * after each mutation, so there is no `revalidatePath`.
 */

const mapIdSchema = z.string().regex(/^\d+$/, 'Invalid map id.');
const roleIdSchema = z.string().regex(/^\d+$/, 'Invalid role id.');
// `view` is implicit — only the six director features are delegatable.
const delegatableCapabilitySchema = z.enum(mapCapability.enumValues).exclude(['view']);

type ActionResult<T = void> =
  | (T extends void ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string };

/**
 * The owning corp's titles joined to their current grants on this map. Manager-
 * gated. Returns `{ available: false }` for private/alliance maps (no corp
 * titles to delegate to in v1).
 */
export async function getMapDelegationState(
  mapId: string,
): Promise<ActionResult<MapDelegationState>> {
  const parsed = mapIdSchema.safeParse(mapId);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  const id = BigInt(parsed.data);

  const session = await requireSession();
  if (!(await canManageMap(BigInt(session.characterId), id))) {
    return { ok: false, error: 'Forbidden.' };
  }

  const [map] = await db
    .select({ type: apMap.type, ownerCorporationId: apMap.ownerCorporationId })
    .from(apMap)
    .where(eq(apMap.id, id));
  if (!map) return { ok: false, error: 'Map not found.' };
  if (map.type !== 'corp' || map.ownerCorporationId === null) {
    return { ok: true, data: { available: false } };
  }

  const rows = await db
    .select({
      roleId: apRole.id,
      name: apRole.name,
      displayLabel: apRole.displayLabel,
      capability: apMapRoleAccess.capability,
    })
    .from(apRole)
    .leftJoin(
      apMapRoleAccess,
      and(eq(apMapRoleAccess.roleId, apRole.id), eq(apMapRoleAccess.mapId, id)),
    )
    .where(and(eq(apRole.source, 'corp_title'), eq(apRole.corporationId, map.ownerCorporationId)))
    .orderBy(asc(apRole.name));

  const byRole = new Map<string, DelegationRole>();
  for (const row of rows) {
    const key = row.roleId.toString();
    let entry = byRole.get(key);
    if (!entry) {
      entry = { roleId: key, label: row.displayLabel ?? row.name, capabilities: [] };
      byRole.set(key, entry);
    }
    if (row.capability && row.capability !== 'view') entry.capabilities.push(row.capability);
  }

  return { ok: true, data: { available: true, roles: [...byRole.values()] } };
}

const setSchema = z.object({
  mapId: mapIdSchema,
  roleId: roleIdSchema,
  capability: delegatableCapabilitySchema,
  enabled: z.boolean(),
});

/**
 * Grant (`enabled`) or revoke a single delegatable capability to a corp title on
 * a corp map. Manager-gated; re-validates that the title is a `corp_title` of
 * this map's owning corp so a forged `roleId` from another corp cannot be
 * granted. Commits one `ap_map_event` naming the title + capability.
 */
export async function setMapDelegation(input: z.input<typeof setSchema>): Promise<ActionResult> {
  const parsed = setSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  const mapId = BigInt(parsed.data.mapId);
  const roleId = BigInt(parsed.data.roleId);
  const { capability, enabled } = parsed.data;

  const session = await requireSession();
  const actorId = BigInt(session.characterId);
  if (!(await canManageMap(actorId, mapId))) return { ok: false, error: 'Forbidden.' };

  const [map] = await db
    .select({ type: apMap.type, ownerCorporationId: apMap.ownerCorporationId })
    .from(apMap)
    .where(eq(apMap.id, mapId));
  if (!map) return { ok: false, error: 'Map not found.' };
  if (map.type !== 'corp' || map.ownerCorporationId === null) {
    return { ok: false, error: 'Delegation is available on corporation maps only.' };
  }

  const [role] = await db
    .select({ name: apRole.name, displayLabel: apRole.displayLabel })
    .from(apRole)
    .where(
      and(
        eq(apRole.id, roleId),
        eq(apRole.source, 'corp_title'),
        eq(apRole.corporationId, map.ownerCorporationId),
      ),
    );
  if (!role) return { ok: false, error: 'Title not found for this map.' };
  const roleName = role.displayLabel ?? role.name;

  const result = await commitMapEvent({
    mapId,
    characterId: actorId,
    kind: enabled ? 'access.granted' : 'access.revoked',
    mutate: async (tx) => {
      if (enabled) {
        await tx.insert(apMapRoleAccess).values({ mapId, roleId, capability }).onConflictDoNothing();
      } else {
        await tx
          .delete(apMapRoleAccess)
          .where(
            and(
              eq(apMapRoleAccess.mapId, mapId),
              eq(apMapRoleAccess.roleId, roleId),
              eq(apMapRoleAccess.capability, capability),
            ),
          );
      }
      return { roleId: roleId.toString(), roleName, capability };
    },
  });

  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true };
}
