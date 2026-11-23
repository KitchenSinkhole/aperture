import type { MapSignature, SignatureGroupKey } from '@/types';
import { SIGNATURE_GROUP_CATALOG } from '@/lib/map/signatureGroups';

const GROUP_ORDER: (SignatureGroupKey | null)[] = [
  ...SIGNATURE_GROUP_CATALOG.map((g) => g.key),
  null,
];

function groupRank(key: SignatureGroupKey | null): number {
  const i = GROUP_ORDER.indexOf(key);
  return i === -1 ? GROUP_ORDER.length : i;
}

/** Experimental default row order: unscanned first, then group catalog order, then sig id. */
export function isSignatureFullyScanned(s: MapSignature): boolean {
  return (
    s.groupKey !== null &&
    (s.groupKey === 'wormhole' ? s.typeId !== null : !!s.name) &&
    (s.groupKey !== 'wormhole' || s.mapConnectionId !== null)
  );
}

export function compareSignaturesExperimental(a: MapSignature, b: MapSignature): number {
  const aScan = isSignatureFullyScanned(a) ? 1 : 0;
  const bScan = isSignatureFullyScanned(b) ? 1 : 0;
  if (aScan !== bScan) return aScan - bScan;
  const ga = groupRank(a.groupKey);
  const gb = groupRank(b.groupKey);
  if (ga !== gb) return ga - gb;
  return a.sigId.localeCompare(b.sigId);
}
