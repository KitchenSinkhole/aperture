import type { EveClockPhase } from '@/types';
import { apertureConfig } from '../../../aperture.config';

/**
 * CCP daily-downtime window check.
 *
 * ESI is expected to fail around CCP's daily server restart. Failures inside
 * this window are not counted against the circuit breakers and are surfaced as
 * an expected `EsiDowntimeError` rather than a real fault. The window is
 * `CCP_SSO_DOWNTIME` ± `CCP_SSO_DOWNTIME_WINDOW_MIN`, padded by
 * `CCP_SSO_DOWNTIME_BUFFER_MIN` on each
 * side. All arithmetic is in UTC.
 */

/** True when `at` falls within CCP's padded daily-downtime window (UTC). */
export function inDowntimeWindow(at: Date = new Date()): boolean {
  const startMin = downtimeStartMin();
  const halfWidth =
    apertureConfig.CCP_SSO_DOWNTIME_WINDOW_MIN + apertureConfig.CCP_SSO_DOWNTIME_BUFFER_MIN;

  const nowMin = at.getUTCHours() * 60 + at.getUTCMinutes();
  // Circular minute-of-day distance so a window straddling midnight still works.
  const diff = Math.abs(nowMin - startMin);
  const circularDiff = Math.min(diff, 1440 - diff);
  return circularDiff <= halfWidth;
}

/** The "hour before downtime" window the clock highlights, in minutes. */
export const PRE_DOWNTIME_MIN = 60;

/**
 * Whole minutes until the next `CCP_SSO_DOWNTIME` (UTC). Wraps past midnight, so
 * the value is always in `1..1440`; at exactly the downtime minute it returns
 * `1440` (a full day to the *next* one) — callers distinguish "downtime now"
 * via `inDowntimeWindow`.
 */
export function minutesUntilDowntime(at: Date = new Date()): number {
  const nowMin = at.getUTCHours() * 60 + at.getUTCMinutes();
  const diff = downtimeStartMin() - nowMin;
  return diff <= 0 ? diff + 1440 : diff;
}

/**
 * Display phase for the Eve-time clock: `'pre'` in the hour before downtime,
 * `'downtime'` inside the padded window, else `'normal'`. `'pre'` is checked
 * first so the countdown flips to `'downtime'` at the downtime minute rather
 * than at the padded window's leading edge.
 */
export function eveClockPhase(at: Date = new Date()): EveClockPhase {
  const until = minutesUntilDowntime(at);
  if (until >= 1 && until <= PRE_DOWNTIME_MIN) return 'pre';
  if (inDowntimeWindow(at)) return 'downtime';
  return 'normal';
}

/** `CCP_SSO_DOWNTIME` as a minute-of-day (UTC). */
function downtimeStartMin(): number {
  const [hh, mm] = apertureConfig.CCP_SSO_DOWNTIME.split(':').map(Number);
  return hh! * 60 + mm!;
}
