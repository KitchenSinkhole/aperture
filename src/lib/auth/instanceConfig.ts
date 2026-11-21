// NOTE: deliberately no `import 'server-only'` — mirrors `loginGate.ts` /
// `resolveAuthz.ts`. Read by the `/setup` Server Actions (server-side) and
// exercised by integration tests under plain Node (tsx/vitest), so it must load
// without the `react-server` resolver condition.
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { apAccessGrant, apInstance, apInstanceOwner } from '@/db/schema';
import type { AccessMode } from '@/types';

/**
 * Read/write helper for the per-deployment access
 * configuration the `/setup` ops console drives: the `ap_instance` singleton's
 * `access_mode`, the `ap_instance_owner` entries, and the instance-scoped
 * `ap_access_grant` allowlist (login / admin).
 *
 * Pure DB layer — no auth gating (the caller, `src/app/(setup)/actions.ts`,
 * gates on the `ap_setup` cookie). Writes take effect immediately for the
 * live-read paths (login gating in `loginGate.ts`); the cached
 * `ap_character.authz_level` updates on the affected character's next resync.
 */

/** `ap_instance_owner` is constrained to organisations by a CHECK. */
export type OwnerKind = 'corporation' | 'alliance';
/** Instance-scoped capabilities — the only ones the setup allowlist issues. */
export type InstanceGrantCapability = 'login' | 'admin';
export type GrantPrincipalKind = 'character' | 'corporation' | 'alliance' | 'role';

export interface InstanceOwnerRow {
  principalKind: OwnerKind;
  principalId: bigint;
  createdAt: Date;
}

export interface InstanceGrantRow {
  id: bigint;
  principalKind: GrantPrincipalKind;
  principalId: bigint;
  capability: InstanceGrantCapability;
  expiresAt: Date | null;
  note: string | null;
  grantedAt: Date;
}

export interface InstanceConfig {
  accessMode: AccessMode;
  /** NULL only on a fresh instance whose singleton row was never written. */
  updatedAt: Date | null;
  owners: InstanceOwnerRow[];
  grants: InstanceGrantRow[];
}

/**
 * Read the full instance access configuration in one shot for the setup page.
 * A missing singleton row reports `restricted` (a fresh deployment is locked
 * down, matching `loginGate.getAccessMode`).
 */
export async function getInstanceConfig(): Promise<InstanceConfig> {
  const [row] = await db
    .select({ accessMode: apInstance.accessMode, updatedAt: apInstance.updatedAt })
    .from(apInstance)
    .where(eq(apInstance.id, 1));

  const owners = await db
    .select({
      principalKind: apInstanceOwner.principalKind,
      principalId: apInstanceOwner.principalId,
      createdAt: apInstanceOwner.createdAt,
    })
    .from(apInstanceOwner)
    .orderBy(asc(apInstanceOwner.principalKind), asc(apInstanceOwner.principalId));

  const grants = await db
    .select({
      id: apAccessGrant.id,
      principalKind: apAccessGrant.principalKind,
      principalId: apAccessGrant.principalId,
      capability: apAccessGrant.capability,
      expiresAt: apAccessGrant.expiresAt,
      note: apAccessGrant.note,
      grantedAt: apAccessGrant.grantedAt,
    })
    .from(apAccessGrant)
    .where(
      and(
        eq(apAccessGrant.scope, 'instance'),
        inArray(apAccessGrant.capability, ['login', 'admin']),
      ),
    )
    .orderBy(asc(apAccessGrant.capability), asc(apAccessGrant.principalKind), asc(apAccessGrant.id));

  return {
    accessMode: row?.accessMode ?? 'restricted',
    updatedAt: row?.updatedAt ?? null,
    // The CHECK constraint guarantees owner kind ∈ {corporation, alliance}; the
    // capability filter above keeps the Blackout cleared list out of the
    // allowlist.
    owners: owners as InstanceOwnerRow[],
    grants: grants as InstanceGrantRow[],
  };
}

/** Upsert the singleton `ap_instance` row with the chosen access mode. */
export async function setAccessMode(mode: AccessMode): Promise<void> {
  await db
    .insert(apInstance)
    .values({ id: 1, accessMode: mode })
    .onConflictDoUpdate({
      target: apInstance.id,
      set: { accessMode: mode, updatedAt: sql`now()` },
    });
}

/** Add an owner organisation. Idempotent on the `(kind, id)` primary key. */
export async function addOwner(kind: OwnerKind, principalId: bigint): Promise<void> {
  await db
    .insert(apInstanceOwner)
    .values({ principalKind: kind, principalId })
    .onConflictDoNothing();
}

/** Remove an owner organisation. A no-op if it was not present. */
export async function removeOwner(kind: OwnerKind, principalId: bigint): Promise<void> {
  await db
    .delete(apInstanceOwner)
    .where(
      and(eq(apInstanceOwner.principalKind, kind), eq(apInstanceOwner.principalId, principalId)),
    );
}

export interface AddInstanceGrantInput {
  principalKind: GrantPrincipalKind;
  principalId: bigint;
  capability: InstanceGrantCapability;
  /** NULL/omitted = permanent; a future timestamp = auto-revoked at expiry. */
  expiresAt?: Date | null;
  note?: string | null;
  grantedByCharacterId?: bigint | null;
}

/**
 * Issue (or update) an instance-scoped grant. Re-issuing an existing
 * `(principalKind, principalId, capability)` refreshes its `expires_at` / `note`
 * rather than erroring on the unique constraint — so the console can extend or
 * annotate an allowlist entry without a remove/re-add dance.
 */
export async function addInstanceGrant(input: AddInstanceGrantInput): Promise<void> {
  await db
    .insert(apAccessGrant)
    .values({
      principalKind: input.principalKind,
      principalId: input.principalId,
      scope: 'instance',
      mapId: null,
      capability: input.capability,
      expiresAt: input.expiresAt ?? null,
      note: input.note ?? null,
      grantedByCharacterId: input.grantedByCharacterId ?? null,
    })
    .onConflictDoUpdate({
      target: [
        apAccessGrant.principalKind,
        apAccessGrant.principalId,
        apAccessGrant.scope,
        apAccessGrant.mapId,
        apAccessGrant.capability,
      ],
      set: {
        expiresAt: input.expiresAt ?? null,
        note: input.note ?? null,
        grantedByCharacterId: input.grantedByCharacterId ?? null,
        grantedAt: sql`now()`,
      },
    });
}

/**
 * Delete an instance-scoped grant by id. The `scope='instance'` guard prevents
 * this ops-console path from touching reserved `scope='map'` share rows.
 */
export async function removeGrant(id: bigint): Promise<void> {
  await db
    .delete(apAccessGrant)
    .where(and(eq(apAccessGrant.id, id), eq(apAccessGrant.scope, 'instance')));
}
