import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  integer,
  pgTable,
  primaryKey,
  smallint,
  timestamp,
} from 'drizzle-orm/pg-core';
import { accessMode, accessPrincipal } from './enums';

// Permissions-overhaul. Per-deployment access configuration.
//
// `ap_instance` is a singleton config row (enforced `id = 1`) carrying the
// instance-wide `access_mode`. `restricted` (default) gates login behind the
// allowlist + owner membership (see `src/lib/auth/loginGate.ts`); `open`
// allows any EVE account to log in.
//
// `ap_instance_owner` names the corp(s)/alliance(s) that own this deployment.
// Ownership is a login-gating concern only: members of an owner entity are
// implicitly allowed to log in (you can never lock yourself out). Ownership does
// NOT confer authz — global `admin` comes solely from an explicit
// `ap_access_grant` (`capability='admin'`); see `resolveAuthzLevel`. Owner
// designation is a DB setting so it is reachable from the password-gated
// `/setup` console before anyone can log in.
export const apInstance = pgTable(
  'ap_instance',
  {
    // Singleton: there is exactly one config row, pinned to id 1.
    id: smallint('id').primaryKey(),
    accessMode: accessMode('access_mode').notNull().default('restricted'),
    // Global default for the stale-signature indicator (minutes). A system whose
    // newest signature is older than this is flagged on the map. Admins edit it;
    // each user may override it to a *smaller* value (never larger) on `ap_user`.
    staleSignatureThresholdMinutes: integer('stale_signature_threshold_minutes')
      .notNull()
      .default(240),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('ap_instance_singleton_chk', sql`${t.id} = 1`)],
);

export const apInstanceOwner = pgTable(
  'ap_instance_owner',
  {
    // Reuses `access_principal` but is constrained to corp/alliance below — an
    // instance is owned by an organisation, never a single character or role.
    principalKind: accessPrincipal('principal_kind').notNull(),
    // EVE corporation_id or alliance_id (64-bit). No FK: `ap_corporation` is a
    // sparse cache and an alliance table does not exist app-wide.
    principalId: bigint('principal_id', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.principalKind, t.principalId], name: 'ap_instance_owner_pk' }),
    check(
      'ap_instance_owner_kind_chk',
      sql`${t.principalKind} in ('corporation', 'alliance')`,
    ),
  ],
);
