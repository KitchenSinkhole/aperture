import { and, eq, or, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { universeStargateEdge } from '@/db/schema';

/**
 * Pure jump classifier consumed by the location-poll. Decides
 * whether a transition between two systems is a gate jump (ignore — gates are
 * already on every map by virtue of `universe_stargate_edge`) or a wormhole
 * jump (fold onto the character's tracked maps as `system.added` /
 * `connection.create` events).
 *
 * Single PK probe against `universe_stargate_edge` in either direction; no
 * recursion, no path-finding. The edge table is bidirectional in practice
 * (each stargate pair lives as two rows) but we check both orderings
 * defensively in case a future SDE ingest stops mirroring them.
 *
 * Classifications outside `gate`/`wormhole`/`teleport`/`abyssal` (e.g. cyno,
 * jump bridge) are NOT modelled here — the rebuild treats every other non-gate,
 * in-space transition as a wormhole. Those rarer cases land alongside the
 * broader intel module work in later stages.
 *
 * `teleport` covers pod self-destruct ("pod express"), getting podded by
 * hostiles, and jump clones: instant moves to a medical/jump clone that the
 * poll would otherwise misread as a wormhole. The tell is that the pilot
 * arrives **docked** — you can never exit a wormhole already docked, so a
 * docked arrival in a non-gate-adjacent system is a teleport-to-station, not a
 * traversal. Gated to k-space destinations because clones can only live there.
 *
 * `abyssal` covers any transition where either endpoint is an abyssal system
 * (`universe_system.security = 'A'`). Abyssals are reached only through
 * single-use filaments, so the link can never be re-traversed by anyone else.
 * The caller (`locationCommit.ts`) folds it as a `scope='abyssal'` connection
 * on maps with `ap_map.track_abyssal_jumps` set, skipping the mass-log and
 * auto-tagging that apply to a `wormhole` fold.
 */

export type JumpClass = 'gate' | 'wormhole' | 'teleport' | 'abyssal';

export interface ClassifyJumpArgs {
  fromSystemId: number;
  toSystemId: number;
  /** Pilot arrived docked (station/structure id present in the location payload). */
  arrivedDocked: boolean;
}

/** `universe_system.security` labels for k-space (see `src/lib/sde/security.ts`). */
const KSPACE_LABELS = new Set(['H', 'L', '0.0']);

export async function classifyJump(args: ClassifyJumpArgs): Promise<JumpClass> {
  if (args.fromSystemId === args.toSystemId) {
    // Defensive: caller should never invoke with the same id, but if they do
    // it's plainly not a jump — return 'gate' so no map writes happen.
    return 'gate';
  }
  const probe = await db.execute<{
    adjacent: boolean;
    abyssal: boolean;
    to_security: string | null;
  }>(
    sql`SELECT
          EXISTS (
            SELECT 1 FROM universe_stargate_edge
            WHERE (from_system_id = ${args.fromSystemId} AND to_system_id = ${args.toSystemId})
               OR (from_system_id = ${args.toSystemId} AND to_system_id = ${args.fromSystemId})
          ) AS adjacent,
          EXISTS (
            SELECT 1 FROM universe_system
            WHERE id IN (${args.fromSystemId}, ${args.toSystemId}) AND security = 'A'
          ) AS abyssal,
          (SELECT security FROM universe_system WHERE id = ${args.toSystemId}) AS to_security`,
  );
  const row = probe.rows[0];
  if (row?.adjacent) return 'gate';
  // Either endpoint abyssal = single-use filament trace, never a chain edge.
  if (row?.abyssal) return 'abyssal';
  // Docked arrival in k-space = teleport-to-clone, never a wormhole traversal.
  if (args.arrivedDocked && row?.to_security != null && KSPACE_LABELS.has(row.to_security)) {
    return 'teleport';
  }
  return 'wormhole';
}

/**
 * Drizzle-builder equivalent of the EXISTS query, exposed for callers that
 * want to compose it into a larger query (e.g. a future bulk classifier).
 * Not used by `classifyJump` itself because the raw form reads more clearly.
 */
export function gateAdjacencyCondition(fromSystemId: number, toSystemId: number) {
  return or(
    and(
      eq(universeStargateEdge.fromSystemId, fromSystemId),
      eq(universeStargateEdge.toSystemId, toSystemId),
    ),
    and(
      eq(universeStargateEdge.fromSystemId, toSystemId),
      eq(universeStargateEdge.toSystemId, fromSystemId),
    ),
  );
}
