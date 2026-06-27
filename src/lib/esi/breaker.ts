import { apertureConfig } from '../../../aperture.config';

/**
 * Per-endpoint (keyed by swagger `operationId`) circuit breaker for ESI.
 *
 * A run of consecutive failures on one operation trips its breaker open so the
 * client stops hammering a failing endpoint. After a cooldown the breaker goes
 * half-open and admits a single trial request: success closes it, another
 * failure re-opens it. State is in-process (a `Map`) — there is no shared store
 * (SPEC: no Redis); each Node process keeps its own breaker set.
 *
 * Downtime failures must NOT reach `recordFailure` — the caller checks
 * `inDowntimeWindow()` first so expected outages don't trip the breaker.
 */

export type BreakerState = 'closed' | 'open' | 'half-open';

interface Breaker {
  state: BreakerState;
  consecutiveFailures: number;
  /** Epoch ms when an open breaker becomes eligible for a half-open trial. */
  openUntil: number;
}

const breakers = new Map<string, Breaker>();

function get(operationId: string): Breaker {
  let b = breakers.get(operationId);
  if (!b) {
    b = { state: 'closed', consecutiveFailures: 0, openUntil: 0 };
    breakers.set(operationId, b);
  }
  return b;
}

/**
 * Whether a request to `operationId` may proceed. Returns true when closed, or
 * when an open breaker's cooldown has elapsed (transitioning it to half-open to
 * admit one trial). Returns false while the breaker is open and cooling down.
 */
export function canRequest(operationId: string): boolean {
  const b = get(operationId);
  if (b.state === 'open' && Date.now() >= b.openUntil) {
    b.state = 'half-open';
  }
  return b.state !== 'open';
}

/** Record a successful response — closes the breaker and clears the failure run. */
export function recordSuccess(operationId: string): void {
  const b = get(operationId);
  b.state = 'closed';
  b.consecutiveFailures = 0;
  b.openUntil = 0;
}

/**
 * Record a failure. A half-open trial failure re-opens immediately; otherwise
 * the breaker opens once `ESI_BREAKER_FAILURE_THRESHOLD` consecutive failures
 * accumulate. Do not call this for downtime-window failures.
 */
export function recordFailure(operationId: string): void {
  const b = get(operationId);
  b.consecutiveFailures += 1;
  if (b.state === 'half-open' || b.consecutiveFailures >= apertureConfig.ESI_BREAKER_FAILURE_THRESHOLD) {
    b.state = 'open';
    b.openUntil = Date.now() + apertureConfig.ESI_BREAKER_COOLDOWN_MS;
  }
}

/** Current breaker state for `operationId` (for observability/tests). */
export function breakerState(operationId: string): BreakerState {
  return get(operationId).state;
}

/**
 * How many breakers are currently open. Reads state without mutating it — unlike
 * `canRequest`, a cooled-down open breaker is *not* transitioned to half-open
 * here. Used by the health probe / metrics to gauge ESI degradation.
 */
export function openBreakerCount(): number {
  let count = 0;
  for (const b of breakers.values()) {
    if (b.state === 'open') count += 1;
  }
  return count;
}

/** Test-only: clear all breaker state. */
export function __resetBreakersForTest(): void {
  breakers.clear();
}
