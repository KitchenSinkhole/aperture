import { resolveIndicator, summariseSignatures, type SigSummary } from '@/lib/map/signatureIndicators';
import type { MapSignature, SignatureIndicatorPrefs } from '@/types';

/** Whether a system's signature rollup is stale under account indicator prefs. */
export function isMapSystemStaleForCleanup(
  summary: SigSummary | undefined,
  isWormhole: boolean,
  prefs: SignatureIndicatorPrefs,
  nowMs = Date.now(),
): boolean {
  const state = resolveIndicator(summary, isWormhole, prefs, nowMs);
  return state.stale && state.ageMs !== null;
}

/** Stale `mapSystemId`s that still have at least one signature row. */
export function staleSignatureMapSystemIds(
  signatures: MapSignature[],
  systemIsWormhole: (mapSystemId: string) => boolean,
  prefs: SignatureIndicatorPrefs,
  nowMs = Date.now(),
): Set<string> {
  const summaries = summariseSignatures(signatures);
  const out = new Set<string>();
  for (const [mapSystemId, summary] of summaries) {
    if (isMapSystemStaleForCleanup(summary, systemIsWormhole(mapSystemId), prefs, nowMs)) {
      out.add(mapSystemId);
    }
  }
  return out;
}
