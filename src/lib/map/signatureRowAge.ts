/** Row age tint for the experimental signatures table (from `updatedAt`). */

export type SignatureRowAgeTier = 'fresh' | 'warm' | 'stale';

const WARM_MS = 2 * 60 * 60 * 1000;
const STALE_MS = 8 * 60 * 60 * 1000;

export function signatureRowAgeTier(updatedAtIso: string, nowMs = Date.now()): SignatureRowAgeTier {
  const ts = new Date(updatedAtIso).getTime();
  if (Number.isNaN(ts)) return 'fresh';
  const age = nowMs - ts;
  if (age >= STALE_MS) return 'stale';
  if (age >= WARM_MS) return 'warm';
  return 'fresh';
}

export function signatureRowAgeClass(tier: SignatureRowAgeTier): string {
  switch (tier) {
    case 'warm':
      return 'ap-sig-age-warm';
    case 'stale':
      return 'ap-sig-age-stale';
    default:
      return '';
  }
}
