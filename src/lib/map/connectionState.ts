import { apertureConfig } from '../../../aperture.config';
import type { MapConnectionEdge } from './loadMap';

/**
 * Pure helpers that derive a wormhole connection's expiry timestamp / time
 * remaining from its `eolStage` / `eolAt` / `createdAt` stamps + the hard-coded
 * lifetime constants in `aperture.config.ts`. Stargate / jumpbridge / abyssal
 * scopes never expire — the EOL state machine only applies to wormholes.
 *
 * Display-only: these drive the client-side EOL countdown and the "Expires in X"
 * inspector hint, so the EOL branches use the in-game *nominal* lifetimes
 * (`WORMHOLE_EOL_NOMINAL_MS` / `WORMHOLE_EOL_CRITICAL_NOMINAL_MS`). The
 * `eol-expiry` reap job runs on the longer nominal + grace-buffer thresholds
 * (`WORMHOLE_EOL_LIFETIME_MS` / `…_CRITICAL_LIFETIME_MS`) via its own SQL, so a
 * hole counts down to zero here a little before Aperture actually purges it. The
 * manual `expired` stage is separate: no countdown, an elapsed-since readout
 * (`connectionExpiredSinceMs`).
 */

const { WORMHOLE_EOL_NOMINAL_MS, WORMHOLE_EOL_CRITICAL_NOMINAL_MS, WORMHOLE_DEFAULT_LIFETIME_MS } =
  apertureConfig;

/** Subset of `MapConnectionEdge` the lifecycle helpers actually need. */
export type ConnectionLifecycleInput = Pick<
  MapConnectionEdge,
  'scope' | 'eolStage' | 'eolAt' | 'createdAt'
>;

/**
 * The wall-clock instant a connection expires, or `null` when no expiry
 * applies. A wormhole in the `critical` (1h) stage expires
 * `WORMHOLE_EOL_CRITICAL_NOMINAL_MS` after `eolAt`; in the `eol` (4h) stage,
 * `WORMHOLE_EOL_NOMINAL_MS` after `eolAt`; a non-EOL (`none`) wormhole expires
 * `WORMHOLE_DEFAULT_LIFETIME_MS` after `createdAt`. The manual `expired` stage
 * has no timed expiry and returns `null`. Stargate / jumpbridge / abyssal
 * connections never expire and return `null`. An EOL stage without an `eolAt`
 * stamp (defensive — a stale client snapshot) also returns `null`.
 */
export function connectionExpiresAt(c: ConnectionLifecycleInput): Date | null {
  if (c.scope !== 'wh') return null;
  // The manual terminal stage carries no timed expiry — it is past guaranteed life.
  if (c.eolStage === 'expired') return null;
  if (c.eolStage === 'none') {
    return new Date(new Date(c.createdAt).getTime() + WORMHOLE_DEFAULT_LIFETIME_MS);
  }
  if (!c.eolAt) return null;
  const lifetime =
    c.eolStage === 'critical' ? WORMHOLE_EOL_CRITICAL_NOMINAL_MS : WORMHOLE_EOL_NOMINAL_MS;
  return new Date(new Date(c.eolAt).getTime() + lifetime);
}

/**
 * Milliseconds until `connectionExpiresAt(c)`. Returns `null` for
 * non-expiring connections, `0` for ones that have already passed expiry.
 *
 * **Parameters:**
 * - `c` — the connection lifecycle fields.
 * - `now` — clock to compare against (defaults to `Date.now()`; injectable for tests).
 */
export function connectionTimeLeftMs(
  c: ConnectionLifecycleInput,
  now: number = Date.now(),
): number | null {
  const expiresAt = connectionExpiresAt(c);
  if (!expiresAt) return null;
  return Math.max(0, expiresAt.getTime() - now);
}

/**
 * Milliseconds elapsed since a wormhole was manually marked `expired`, measured
 * from `eolAt` (the flag instant). Returns `null` for any other stage / scope,
 * or when the `expired` stage lacks an `eolAt` stamp. Drives the "Expired X ago"
 * readout that replaces the countdown on an expired hole.
 *
 * **Parameters:**
 * - `c` — the connection lifecycle fields.
 * - `now` — clock to compare against (defaults to `Date.now()`; injectable for tests).
 */
export type EolTimeUrgency = 'warning' | 'critical';

/** Live EOL urgency from countdown: &lt;4h warning (orange), ≤1h or elapsed critical (red). */
export function eolTimeUrgencyFromMs(timeLeftMs: number | null): EolTimeUrgency | null {
  if (timeLeftMs == null || !Number.isFinite(timeLeftMs)) return null;
  if (timeLeftMs <= 0) return 'critical';
  if (timeLeftMs <= WORMHOLE_EOL_CRITICAL_NOMINAL_MS) return 'critical';
  if (timeLeftMs < WORMHOLE_EOL_NOMINAL_MS) return 'warning';
  return null;
}

/** Urgency for experimental EOL outline and tags from stage + live countdown. */
export function eolDisplayUrgency(
  stage: ConnectionLifecycleInput['eolStage'],
  timeLeftMs: number | null,
): EolTimeUrgency | null {
  if (stage === 'expired') return 'critical';
  if (stage !== 'eol' && stage !== 'critical') return null;
  return eolTimeUrgencyFromMs(timeLeftMs);
}

/** Compact tag for connection-edge EOL labels (e.g. `3h 42m`). */
export function formatEolTimeLeftTag(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0m';
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

export function connectionExpiredSinceMs(
  c: ConnectionLifecycleInput,
  now: number = Date.now(),
): number | null {
  if (c.scope !== 'wh' || c.eolStage !== 'expired' || !c.eolAt) return null;
  return Math.max(0, now - new Date(c.eolAt).getTime());
}
