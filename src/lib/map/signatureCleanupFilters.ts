import type { MapConnectionEdge, MapSignature, SignatureGroupKey } from '@/types';

export type SignatureCleanupFilterId =
  | 'older_than_hours'
  | 'missing_from_paste'
  | 'wh_link_expired'
  | 'unscanned_only'
  | 'group_combat'
  | 'group_data'
  | 'group_relic'
  | 'group_gas'
  | 'group_wh'
  | 'group_ore'
  | 'group_ghost';

export type SignatureCleanupOptions = {
  olderThanHours?: number;
  missingFromPasteIds?: Set<string>;
  groups?: SignatureGroupKey[];
  unscannedOnly?: boolean;
  whLinkExpiredConnectionIds?: Set<string>;
};

export function isSignatureFullyScanned(sig: MapSignature): boolean {
  return (
    sig.groupKey !== null &&
    (sig.groupKey === 'wormhole' ? sig.typeId !== null : !!sig.name) &&
    (sig.groupKey !== 'wormhole' || sig.mapConnectionId !== null)
  );
}

export function signatureMatchesCleanupFilter(
  sig: MapSignature,
  linkById: Map<string, MapConnectionEdge>,
  opts: SignatureCleanupOptions,
): boolean {
  if (opts.unscannedOnly && isSignatureFullyScanned(sig)) return false;
  if (opts.groups?.length && sig.groupKey != null && !opts.groups.includes(sig.groupKey)) return false;
  if (opts.olderThanHours != null && sig.updatedAt) {
    const ageH = (Date.now() - Date.parse(sig.updatedAt)) / 3_600_000;
    if (ageH < opts.olderThanHours) return false;
  }
  if (opts.missingFromPasteIds && !opts.missingFromPasteIds.has(sig.sigId)) return false;
  if (opts.whLinkExpiredConnectionIds?.size) {
    if (!sig.mapConnectionId) return false;
    const conn = linkById.get(sig.mapConnectionId);
    if (!conn || conn.eolStage !== 'expired') return false;
  }
  return true;
}

export function filterSignaturesForCleanup(
  signatures: MapSignature[],
  connections: MapConnectionEdge[],
  opts: SignatureCleanupOptions,
): MapSignature[] {
  const linkById = new Map(connections.map((c) => [c.id, c]));
  return signatures.filter((s) => signatureMatchesCleanupFilter(s, linkById, opts));
}
