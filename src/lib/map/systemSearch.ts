import 'server-only';
import { eq, ilike, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { universeConstellation, universeRegion, universeSystem } from '@/db/schema';

/**
 * Solar-system name search for the "add system manually" flow — the
 * way a system lands on a map without a tracked character physically jumping a
 * wormhole into it. Pure read-side helper; the route layer carries the map-view
 * guard.
 */

export type SystemSearchResult = {
  /** EVE solar-system id (`universe_system.id`), the value POSTed to add the system. */
  id: number;
  name: string;
  /** Class / sec-band label, e.g. `C3`, `HS`, `0.5`. */
  security: string | null;
  securityStatus: number | null;
  regionName: string;
  constellationName: string;
};

const SEARCH_LIMIT = 25;
const MIN_QUERY_LENGTH = 2;

/** Escape Postgres `LIKE` metacharacters so user input is matched literally. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Case-insensitive substring search over `universe_system.name`. Returns at most
 * `SEARCH_LIMIT` rows, prefix matches first, then shortest name, then
 * alphabetical — so typing `jit` surfaces `Jita` ahead of longer incidental
 * substring hits. Queries shorter than `MIN_QUERY_LENGTH` chars return `[]` to
 * avoid scanning the whole universe on the first keystroke.
 */
export async function searchSystems(query: string): Promise<SystemSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return [];

  const escaped = escapeLike(trimmed);
  const substring = `%${escaped}%`;
  const prefix = `${escaped}%`;

  return db
    .select({
      id: universeSystem.id,
      name: universeSystem.name,
      security: universeSystem.security,
      securityStatus: universeSystem.securityStatus,
      regionName: universeRegion.name,
      constellationName: universeConstellation.name,
    })
    .from(universeSystem)
    .innerJoin(
      universeConstellation,
      eq(universeSystem.constellationId, universeConstellation.id),
    )
    .innerJoin(universeRegion, eq(universeConstellation.regionId, universeRegion.id))
    .where(ilike(universeSystem.name, substring))
    .orderBy(
      sql`(${universeSystem.name} ilike ${prefix}) desc`,
      sql`length(${universeSystem.name})`,
      universeSystem.name,
    )
    .limit(SEARCH_LIMIT);
}
