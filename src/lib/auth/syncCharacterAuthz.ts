import { and, eq, inArray, notInArray } from 'drizzle-orm';
import { apertureConfig } from '../../../aperture.config';
import { db } from '@/db/client';
import {
  apAlliance,
  apCharacter,
  apCharacterRole,
  apCorporation,
  apRole,
} from '@/db/schema';
import { resolveAuthzLevel } from '@/lib/auth/resolveAuthz';
import { fetchAffiliations, type CharacterAffiliation } from '@/lib/esi/affiliation';
import {
  esiCall,
  EsiBreakerOpenError,
  EsiDowntimeError,
  EsiHttpError,
  EsiTokenError,
  EsiTokenTransientError,
} from '@/lib/esi/client';
import {
  allianceSchema,
  characterPublicSchema,
  characterRolesSchema,
  characterTitlesSchema,
  type EsiAlliance,
  type EsiCharacterPublic,
  type EsiCharacterRoles,
  type EsiCharacterTitles,
} from '@/lib/esi/decoders';

/**
 * Reconcile one character's derived authority state against ESI in
 * a single transactional pass. Three pieces of state are touched:
 *
 *   1. `ap_character.authz_level`         — recomputed via `resolveAuthzLevel`:
 *                                            `'member'` or `'admin'` only.
 *                                            Global `'admin'` comes only from an
 *                                            explicit `ap_access_grant`
 *                                            `capability='admin'`; the Director
 *                                            role does NOT raise the tier (it is
 *                                            carried separately by `is_director`).
 *                                            The level is a deterministic cache,
 *                                            written verbatim every pass — no
 *                                            preserve-hack.
 *   2. `ap_character.corporation_id` /
 *      `ap_character.alliance_id` /
 *      `ap_character.is_director`         — refreshed from `getCharacterAffiliation`
 *                                            (corp/alliance, ~1h cache) +
 *                                            `getCharacterRoles`. `ap_corporation`
 *                                            row upserted as a side effect (FK
 *                                            target for role rows); `ap_alliance` row
 *                                            upserted from `getAlliance` when the
 *                                            character has an alliance (caches the
 *                                            executor corp for `canManageMap`).
 *                                            `is_director` is the raw ESI Director
 *                                            bit, carrying corp/alliance map
 *                                            authority in the derived model.
 *   3. `ap_character_role` rows tagged
 *      `source='corp_title'`              — reconciled to match the titles ESI
 *                                            returns; roles upserted into
 *                                            `ap_role`, memberships inserted
 *                                            for newly-held titles, deleted for
 *                                            titles no longer held.
 *
 * Called from:
 *   - The Auth.js JWT callback on initial sign-in (`src/lib/auth.ts`).
 *   - The `character-cleanup` job on its periodic resync pass.
 *
 * ESI-failure modes are caught by the caller's choice of policy; this helper
 * propagates them as-is (`EsiBreakerOpenError`, `EsiDowntimeError`,
 * `EsiHttpError`, `EsiTokenError`). On any of those, the function aborts
 * before mutating the DB so a partial sync never lands.
 */
export interface SyncCharacterAuthzResult {
  authzLevel: 'member' | 'admin';
  isDirector: boolean;
  corporationId: bigint | null;
  allianceId: bigint | null;
  /** Executor corp of the character's alliance (from the `ap_alliance` upsert), null when unaffiliated. */
  executorCorporationId: bigint | null;
  titleCount: number;
  /** `true` when ESI was reachable and the DB was updated. */
  applied: boolean;
  /** Reason the sync was skipped (when `applied === false`). */
  skipped?: 'esi-breaker' | 'esi-downtime' | 'esi-http' | 'no-token' | 'token-refresh';
}

export async function syncCharacterAuthz(
  characterId: bigint,
): Promise<SyncCharacterAuthzResult> {
  let affiliations: Map<bigint, CharacterAffiliation>;
  let roles: EsiCharacterRoles, titles: EsiCharacterTitles;
  let profile: EsiCharacterPublic;
  let alliance: EsiAlliance | null = null;
  try {
    // Affiliation (corp/alliance) comes from the bulk affiliation endpoint
    // (~1h cache) rather than the public profile (~24h) so corp moves surface
    // within the hour. The public profile is fetched too, but only for `name`:
    // it is the authoritative source for a CCP-performed rename, which the SSO
    // JWT `name` claim (the login-time source) can lag indefinitely.
    [affiliations, roles, titles, profile] = await Promise.all([
      fetchAffiliations([characterId]),
      esiCall('getCharacterRoles', {
        schema: characterRolesSchema,
        pathParams: { character_id: characterId },
        characterId,
      }),
      esiCall('getCharacterTitles', {
        schema: characterTitlesSchema,
        pathParams: { character_id: characterId },
        characterId,
      }),
      esiCall('getCharacter', {
        schema: characterPublicSchema,
        pathParams: { character_id: characterId },
      }),
    ]);
    // Alliance lookup depends on the just-resolved affiliation, so it follows
    // the parallel batch. Guarded by the same try/catch — if ESI is
    // unreachable the whole sync skips rather than landing a partial write.
    const allianceId = affiliations.get(characterId)?.allianceId ?? null;
    if (allianceId !== null) {
      alliance = await esiCall('getAlliance', {
        schema: allianceSchema,
        pathParams: { alliance_id: allianceId },
      });
    }
  } catch (err) {
    if (err instanceof EsiBreakerOpenError) {
      return emptyResult({ skipped: 'esi-breaker' });
    }
    if (err instanceof EsiDowntimeError) {
      return emptyResult({ skipped: 'esi-downtime' });
    }
    if (err instanceof EsiTokenError) {
      return emptyResult({ skipped: 'no-token' });
    }
    if (err instanceof EsiTokenTransientError) {
      return emptyResult({ skipped: 'token-refresh' });
    }
    if (err instanceof EsiHttpError) {
      return emptyResult({ skipped: 'esi-http' });
    }
    throw err;
  }

  // ESI omits an id from the affiliation response only for a non-resolvable
  // character (e.g. biomassed). Treat that as a transient miss and skip rather
  // than stomping a live corp/alliance to null.
  const affiliation = affiliations.get(characterId);
  if (!affiliation) {
    return emptyResult({ skipped: 'esi-http' });
  }

  const isDirector = (roles.roles ?? []).includes(apertureConfig.AUTHZ_ADMIN_ROLE);
  const corporationId = affiliation.corporationId;
  const allianceId = affiliation.allianceId;
  const executorCorporationId =
    alliance?.executor_corporation_id !== undefined
      ? BigInt(alliance.executor_corporation_id)
      : null;

  // Resolve the cached level before the transaction — the grant table it reads
  // is independent of the writes below. `is_director` is persisted separately
  // below; it no longer feeds the authz tier.
  const resolvedLevel = await resolveAuthzLevel(characterId);

  await db.transaction(async (tx) => {
    // 1. Upsert the corp row so subsequent FK targets resolve.
    await tx
      .insert(apCorporation)
      .values({
        id: corporationId,
        name: `corp:${corporationId}`,
        allianceId,
        lastSyncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: apCorporation.id,
        // Refresh affiliation + sync timestamp but do not stomp `name`
        // (the dedicated corp-name resolver fills it in later; this helper
        // is character-driven and may not know the corp's real name).
        set: {
          allianceId,
          lastSyncedAt: new Date(),
        },
      });

    // 1b. Upsert the alliance cache when the character has one, so
    //     `executor_corporation_id` is available to the derived-authority gates.
    //     `name` and executor come from ESI `getAlliance`; this is the only
    //     writer of `ap_alliance`.
    if (allianceId !== null && alliance !== null) {
      await tx
        .insert(apAlliance)
        .values({
          id: allianceId,
          name: alliance.name,
          executorCorporationId,
          lastSyncedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: apAlliance.id,
          set: {
            name: alliance.name,
            executorCorporationId,
            lastSyncedAt: new Date(),
          },
        });
    }

    // 2. Update the character row. `authz_level` is the recomputed cache from
    //    `resolveAuthzLevel` — written verbatim, no preserve-hack. `is_director`
    //    is the raw ESI Director bit, carrying corp/alliance map authority.
    //    `name` tracks ESI's public profile so a CCP rename self-heals here
    //    rather than waiting on a fresh login's (indefinitely-stale) SSO claim.
    await tx
      .update(apCharacter)
      .set({
        name: profile.name,
        corporationId,
        allianceId,
        isDirector,
        authzLevel: resolvedLevel,
        authzSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(apCharacter.id, characterId));

    // 3. Reconcile corp-title roles. Each ESI title → one `ap_role` row
    //    keyed by `(source='corp_title', external_ref='<corp_id>:<title_id>')`.
    //    Memberships in `ap_character_role` are inserted for newly held
    //    titles and deleted for titles no longer present.
    const desiredRefs = titles.map((t) => corpTitleRef(corporationId, t.title_id));

    if (titles.length > 0) {
      // Upsert each role row. ESI is the source of truth for `name`.
      for (const t of titles) {
        await tx
          .insert(apRole)
          .values({
            source: 'corp_title',
            externalRef: corpTitleRef(corporationId, t.title_id),
            name: t.name,
            corporationId,
          })
          .onConflictDoUpdate({
            target: [apRole.source, apRole.externalRef],
            set: { name: t.name, corporationId },
          });
      }

      // Resolve every desired role's id, then insert any missing memberships.
      const desiredRoles = await tx
        .select({ id: apRole.id, externalRef: apRole.externalRef })
        .from(apRole)
        .where(
          and(
            eq(apRole.source, 'corp_title'),
            inArray(apRole.externalRef, desiredRefs),
          ),
        );
      for (const r of desiredRoles) {
        await tx
          .insert(apCharacterRole)
          .values({
            characterId,
            roleId: r.id,
            grantedBy: 'corp-title-sync',
          })
          .onConflictDoNothing({
            target: [apCharacterRole.characterId, apCharacterRole.roleId],
          });
      }
    }

    // 4. Drop memberships for corp-title roles the character no longer holds.
    //    Restrict to `corp_title` source so admin/external grants survive.
    //    Postgres can chain CTEs but a sub-select keeps this readable; the
    //    join is cheap (PK on character_id + secondary index on role_id).
    if (desiredRefs.length === 0) {
      await tx
        .delete(apCharacterRole)
        .where(
          and(
            eq(apCharacterRole.characterId, characterId),
            inArray(
              apCharacterRole.roleId,
              tx
                .select({ id: apRole.id })
                .from(apRole)
                .where(eq(apRole.source, 'corp_title')),
            ),
          ),
        );
    } else {
      await tx
        .delete(apCharacterRole)
        .where(
          and(
            eq(apCharacterRole.characterId, characterId),
            inArray(
              apCharacterRole.roleId,
              tx
                .select({ id: apRole.id })
                .from(apRole)
                .where(
                  and(
                    eq(apRole.source, 'corp_title'),
                    notInArray(apRole.externalRef, desiredRefs),
                  ),
                ),
            ),
          ),
        );
    }
  });

  return {
    authzLevel: resolvedLevel,
    isDirector,
    corporationId,
    allianceId,
    executorCorporationId,
    titleCount: titles.length,
    applied: true,
  };
}

function corpTitleRef(corporationId: bigint, titleId: number): string {
  return `${corporationId.toString()}:${titleId}`;
}

function emptyResult(
  init: Pick<SyncCharacterAuthzResult, 'skipped'>,
): SyncCharacterAuthzResult {
  return {
    authzLevel: 'member',
    isDirector: false,
    corporationId: null,
    allianceId: null,
    executorCorporationId: null,
    titleCount: 0,
    applied: false,
    ...init,
  };
}
