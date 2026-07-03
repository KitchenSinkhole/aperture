import 'server-only';
import { inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import { universeKillmail, universeType } from '@/db/schema';
import { ccpImageUrl } from '@/lib/integrations/links';
import { recentKillsForSystem, type RecentKillSummary } from '@/lib/integrations/zkb';
import { esiCall } from '@/lib/esi/client';
import { killmailSchema, universeNamesSchema, type EsiKillmail } from '@/lib/esi/decoders';
import type { NewUniverseKillmail } from '@/types';

/** A recent kill enriched with victim + ship display data for the sidebar feed. */
export type KillboardKill = RecentKillSummary & {
  killmailTime: string | null;
  shipTypeId: number | null;
  shipName: string | null;
  shipIcon: string | null;
  victimName: string | null;
  victimIcon: string | null;
  attackers: number | null;
};

/** Fetch one ESI killmail, returning null on any failure so one bad row can't sink the feed. */
async function fetchKillmail(killmailId: number, hash: string): Promise<EsiKillmail | null> {
  try {
    return await esiCall('getKillmail', {
      schema: killmailSchema,
      pathParams: { killmail_id: killmailId, killmail_hash: hash },
    });
  } catch {
    return null;
  }
}

/**
 * Resolve full killmail bodies for a batch of zKillboard list entries,
 * cache-aside against `universe_killmail`. Cached ids are served from the table;
 * misses are fetched from ESI (breaker-gated, one call each, failures degrading
 * that row) and written back with `ON CONFLICT DO NOTHING`. Killmail bodies are
 * immutable, so a cached row is authoritative forever and never re-fetched.
 * Returns a map keyed by killmail id (a missing entry means both cache and fetch
 * had nothing).
 */
async function loadKillmails(kills: RecentKillSummary[]): Promise<Map<number, EsiKillmail>> {
  const out = new Map<number, EsiKillmail>();
  const withHash = kills.filter((k) => k.hash != null);
  if (withHash.length === 0) return out;

  const cached = await db
    .select({ id: universeKillmail.id, body: universeKillmail.body })
    .from(universeKillmail)
    .where(
      inArray(
        universeKillmail.id,
        withHash.map((k) => BigInt(k.killmailId)),
      ),
    );
  for (const row of cached) out.set(Number(row.id), row.body as EsiKillmail);

  const misses = withHash.filter((k) => !out.has(k.killmailId));
  const fetched = await Promise.all(misses.map((k) => fetchKillmail(k.killmailId, k.hash!)));

  const inserts: NewUniverseKillmail[] = [];
  misses.forEach((k, i) => {
    const km = fetched[i];
    if (!km) return;
    out.set(k.killmailId, km);
    inserts.push({
      id: BigInt(k.killmailId),
      hash: k.hash!,
      body: km,
      killmailTime: new Date(km.killmail_time),
    });
  });
  if (inserts.length > 0) {
    await db.insert(universeKillmail).values(inserts).onConflictDoNothing();
  }

  return out;
}

/** Resolve a batch of character/corporation ids to display names, best-effort. */
async function resolveNames(ids: number[]): Promise<Map<number, string>> {
  const names = new Map<number, string>();
  if (ids.length === 0) return names;
  try {
    const rows = await esiCall('getUniverseNames', {
      schema: universeNamesSchema,
      body: ids,
    });
    for (const r of rows) names.set(r.id, r.name);
  } catch {
    // Name resolution is decorative — degrade to ids rather than failing the feed.
  }
  return names;
}

/**
 * Recent zKillboard kills for a system, enriched into renderable rows.
 *
 * zKillboard's per-system list endpoint returns only `{ killmailId, hash,
 * totalValue }`, so the victim, their ship, the kill time, and the attacker
 * count are pulled from the full ESI killmail (one `getKillmail` per row, in
 * parallel; individual failures degrade that row rather than the feed). Victim
 * names come from a single batched `getUniverseNames`; ship names from one
 * `universe_type` query. Propagates the zkb client's `ZkbRateLimitError` /
 * `ZkbHttpError` so the route can map them to the right status.
 */
export async function killboardForSystem(
  systemId: number,
  limit: number,
): Promise<KillboardKill[]> {
  const kills = await recentKillsForSystem(systemId, limit);

  const bodies = await loadKillmails(kills);

  const shipTypeIds = new Set<number>();
  const victimIds = new Set<number>();
  for (const km of bodies.values()) {
    if (km.victim.ship_type_id != null) shipTypeIds.add(km.victim.ship_type_id);
    const victimId = km.victim.character_id ?? km.victim.corporation_id;
    if (victimId != null) victimIds.add(victimId);
  }

  const shipNames = new Map<number, string>();
  if (shipTypeIds.size > 0) {
    const rows = await db
      .select({ id: universeType.id, name: universeType.name })
      .from(universeType)
      .where(inArray(universeType.id, [...shipTypeIds]));
    for (const r of rows) shipNames.set(r.id, r.name);
  }

  const victimNames = await resolveNames([...victimIds]);

  return kills.map((k) => {
    const km = bodies.get(k.killmailId) ?? null;
    const shipTypeId = km?.victim.ship_type_id ?? null;
    const characterId = km?.victim.character_id ?? null;
    const corporationId = km?.victim.corporation_id ?? null;
    const victimId = characterId ?? corporationId;
    return {
      ...k,
      killmailTime: km?.killmail_time ?? null,
      shipTypeId,
      shipName: shipTypeId != null ? (shipNames.get(shipTypeId) ?? null) : null,
      shipIcon: shipTypeId != null ? ccpImageUrl('types', shipTypeId, 'icon', 64) : null,
      victimName: victimId != null ? (victimNames.get(victimId) ?? null) : null,
      victimIcon:
        characterId != null
          ? ccpImageUrl('characters', characterId, 'portrait', 64)
          : corporationId != null
            ? ccpImageUrl('corporations', corporationId, 'logo', 64)
            : null,
      attackers: km ? km.attackers.length : null,
    };
  });
}
