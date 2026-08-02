// Static wormhole display order: wormhole classes ascending (C1…C6), then
// k-space by danger (H < L < 0.0 < P), then anything unrecognised.

type SecurityRank = number;
type ClassRank = number;

const FIXED_STATIC_ORDER: Record<string, SecurityRank> = {
  // Wormhole classes take rank 0.
  H: 1,
  L: 2,
  '0.0': 3,
  P: 4,
};

function getStaticRank(value: string): [SecurityRank, ClassRank] {
  const fixed = FIXED_STATIC_ORDER[value];
  if (fixed !== undefined) return [fixed, 0];

  const match = value.match(/^C(\d+)$/);
  if (match) return [0, parseInt(match[1]!, 10)];

  return [5, 0];
}

/** Comparator for static target-class labels (`C3`, `H`, `0.0`, …). */
export function staticCompare(a: string, b: string): number {
  const [ra1, ra2] = getStaticRank(a);
  const [rb1, rb2] = getStaticRank(b);
  return ra1 - rb1 || ra2 - rb2;
}
