import type { MapConnectionEdge, MapSystemNode } from '@/types';

/** EVE solar-system ids for well-known shortcuts (gate graph / EVE-Scout). */
export const JITA_SYSTEM_ID = 30000142;
export const THERA_SYSTEM_ID = 31000005;
export const TURNUR_SYSTEM_ID = 98044006;

const STAGING_TAG = /staging/i;

/** True when the map security label denotes K-space (not a wormhole class). */
export function isKspaceSecurityLabel(security: string | null): boolean {
  if (!security) return false;
  if (/^C\d+$/i.test(security)) return false;
  if (security === 'H' || security === 'L' || security === '0.0') return true;
  if (/^[\d.]+$/.test(security)) return true;
  if (security === 'P' || security.startsWith('A')) return true;
  return false;
}

/**
 * On-map systems that sit in K-space — typical chain exit anchors for compare.
 */
export function chainExitCandidates(systems: MapSystemNode[]): MapSystemNode[] {
  return systems.filter((s) => isKspaceSecurityLabel(s.security));
}

/**
 * On-map systems tagged (or aliased) as staging for one-click routing.
 */
export function stagingTaggedSystems(systems: MapSystemNode[]): MapSystemNode[] {
  return systems.filter((s) => {
    const tag = s.tag?.trim() ?? '';
    const alias = s.alias?.trim() ?? '';
    return STAGING_TAG.test(tag) || STAGING_TAG.test(alias);
  });
}

/**
 * Pick a single chain-exit anchor: prefer the K-space system with the most
 * stargate links on the map (rough proxy for the main bubble), else the first.
 */
export function pickPrimaryChainExit(
  systems: MapSystemNode[],
  connections: MapConnectionEdge[],
): MapSystemNode | null {
  const candidates = chainExitCandidates(systems);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;
  const gateDegree = new Map<string, number>();
  for (const c of connections) {
    if (c.scope !== 'stargate') continue;
    gateDegree.set(c.source, (gateDegree.get(c.source) ?? 0) + 1);
    gateDegree.set(c.target, (gateDegree.get(c.target) ?? 0) + 1);
  }
  let best = candidates[0]!;
  let bestScore = -1;
  for (const s of candidates) {
    const score = gateDegree.get(s.id) ?? 0;
    if (score > bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return best;
}

/** Up to `limit` chain-exit candidates for side-by-side compare (stable order). */
export function topChainExitsForCompare(
  systems: MapSystemNode[],
  connections: MapConnectionEdge[],
  limit = 3,
): MapSystemNode[] {
  const candidates = chainExitCandidates(systems);
  if (candidates.length <= limit) return candidates;
  const scored = candidates.map((s) => {
    let gates = 0;
    for (const c of connections) {
      if (c.scope !== 'stargate') continue;
      if (c.source === s.id || c.target === s.id) gates++;
    }
    return { s, gates };
  });
  scored.sort((a, b) => b.gates - a.gates || a.s.name.localeCompare(b.s.name));
  return scored.slice(0, limit).map((row) => row.s);
}
