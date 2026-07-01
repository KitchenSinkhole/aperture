import type { SignatureGroupKey } from '@/types';

/**
 * Site-safety classification for a cosmic signature: whether running the site
 * pits you against rats (`combat`) or is an unguarded scan-down (`exploration`).
 * Orthogonal to the scanner `groupKey` — a `relic` site can be a `combat`
 * activity (Sleeper-native) or an `exploration` one (null-sec bleed-in).
 *
 * Pure and isomorphic (no DB, no `server-only`) so both the signature panel
 * glyph and the search filter can import it directly.
 *
 * The derived defaults are vendored from the whtype.info "safe-explo" dataset:
 * `SAFE → exploration`, `NOT SAFE → combat`. To update, edit this file and
 * redeploy — we do not fetch the unversioned upstream file at runtime.
 *
 * Source: whtype.info/safe-explo (2026-07-01)
 */

export type SignatureActivity = 'combat' | 'exploration';

/**
 * Derived site-safety of a signature from its resolved site `name` and scanner
 * `groupKey`. Returns `null` when there isn't enough info to classify — an
 * unidentified relic/data site (no name yet), a wormhole, or an unknown group.
 *
 * Keys on `(name, groupKey)` rather than name alone so the
 * `Ordinary Perimeter Reservoir` (gas → combat) vs `Ordinary Perimeter Deposit`
 * (ore → exploration) prefix collision resolves cleanly, and so combat
 * anomalies classify without enumerating every combat site name.
 */
export function siteActivity(
  name: string | null | undefined,
  groupKey: SignatureGroupKey | null | undefined,
): SignatureActivity | null {
  switch (groupKey) {
    case 'wormhole':
      return null;
    case 'combat':
      return 'combat';
    case 'ore':
      return 'exploration';
    case 'ghost':
      return 'combat';
    case 'gas':
      // whtype marks every gas reservoir NOT SAFE (all have a rat spawn).
      return 'combat';
    case 'relic':
    case 'data': {
      if (!name) return null;
      if (
        name.startsWith('Forgotten ') ||
        name.startsWith('Unsecured ') ||
        name.startsWith('Abandoned Research')
      ) {
        return 'combat';
      }
      if (name.startsWith('Ruined ') || name.startsWith('Central ')) {
        return 'exploration';
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * The effective site-safety shown to the user: a persisted `activityOverride`
 * wins over the derived value, otherwise fall back to `siteActivity`. `null`
 * means no glyph — nothing is known and nothing was overridden. Wormholes are
 * never classified or overridable, so they always return `null`.
 */
export function effectiveSignatureActivity(sig: {
  name: string | null;
  groupKey: SignatureGroupKey | null;
  activityOverride?: SignatureActivity | null;
}): SignatureActivity | null {
  if (sig.groupKey === 'wormhole') return null;
  return sig.activityOverride ?? siteActivity(sig.name, sig.groupKey);
}
