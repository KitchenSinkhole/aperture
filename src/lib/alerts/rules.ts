import { apertureConfig } from '../../../aperture.config';
import type { DiscordWebhookPayload } from '@/lib/integrations/discord';
import type {
  AlertRuleKey,
  AlertRuleResult,
  AlertRuleStatus,
  AlertSignals,
  AlertTransition,
} from '@/types';

/**
 * Pure alert rules + the in-memory dedup state machine behind Phase 6 instance
 * alerting. Deliberately DB-free: the rules are pure functions of a gathered
 * `AlertSignals` snapshot, and firing state is a `globalThis` singleton (mirror
 * of `bus.ts` / `breaker.ts`) — never a table. That is what lets alerting fire
 * about a degraded DB, and makes the state machine unit-testable without one.
 *
 * The IO shell (gather signals, dispatch to Discord, schedule) lives in
 * `scheduler.ts`. No `server-only` import here — this is loaded by `server.ts`.
 */

const ORDER: readonly AlertRuleKey[] = [
  'db',
  'worker',
  'esi_breakers',
  'job_abandoned',
  'error_rate',
];

/** Evaluate every rule against one gathered snapshot. Pure — no IO, no clock. */
export function evaluateRules(signals: AlertSignals): AlertRuleResult[] {
  return ORDER.map((key) => RULES[key](signals));
}

const RULES: Record<AlertRuleKey, (signals: AlertSignals) => AlertRuleResult> = {
  db: (signals) => {
    if (signals.dbProbeMs === null) {
      return { key: 'db', status: 'down', detail: 'Database probe failed or timed out.' };
    }
    if (signals.dbProbeMs > apertureConfig.ALERT_DB_SLOW_MS) {
      return { key: 'db', status: 'degraded', detail: `Database slow: ${Math.round(signals.dbProbeMs)}ms probe.` };
    }
    return { key: 'db', status: 'ok', detail: 'Database responsive.' };
  },
  worker: (signals) => {
    if (signals.workerStaleMs === null) {
      return { key: 'worker', status: 'unknown', detail: 'Worker liveness unreadable.' };
    }
    if (signals.workerStaleMs > apertureConfig.HEALTH_WORKER_STALE_MS) {
      return {
        key: 'worker',
        status: 'down',
        detail: `No background job finished in ${Math.round(signals.workerStaleMs / 1000)}s.`,
      };
    }
    return { key: 'worker', status: 'ok', detail: 'Worker alive.' };
  },
  esi_breakers: (signals) => {
    if (signals.openBreakers >= apertureConfig.ALERT_ESI_BREAKERS_OPEN_THRESHOLD) {
      return { key: 'esi_breakers', status: 'degraded', detail: `${signals.openBreakers} ESI breaker(s) open.` };
    }
    return { key: 'esi_breakers', status: 'ok', detail: 'ESI breakers nominal.' };
  },
  job_abandoned: (signals) => {
    if (signals.abandonedJobs === null) {
      return { key: 'job_abandoned', status: 'unknown', detail: 'Abandoned-job query failed.' };
    }
    if (signals.abandonedJobs > 0) {
      return { key: 'job_abandoned', status: 'down', detail: `${signals.abandonedJobs} abandoned job run(s).` };
    }
    return { key: 'job_abandoned', status: 'ok', detail: 'No abandoned jobs.' };
  },
  error_rate: (signals) => {
    if (signals.recentErrors === null) {
      return { key: 'error_rate', status: 'unknown', detail: 'Error-log query failed.' };
    }
    const windowMin = Math.round(apertureConfig.ALERT_ERROR_RATE_WINDOW_MS / 60_000);
    if (signals.recentErrors >= apertureConfig.ALERT_ERROR_RATE_THRESHOLD) {
      return {
        key: 'error_rate',
        status: 'degraded',
        detail: `${signals.recentErrors} errors logged in the last ${windowMin}m.`,
      };
    }
    return { key: 'error_rate', status: 'ok', detail: 'Error rate nominal.' };
  },
};

// --- In-memory dedup state ---

interface RuleState {
  firing: boolean;
  consecutiveBad: number;
  firingSince: number | null;
  lastDetail: string;
  lastStatus: AlertRuleStatus;
}

function freshState(): Map<AlertRuleKey, RuleState> {
  return new Map();
}

declare global {
  var __apertureAlertState: Map<AlertRuleKey, RuleState> | undefined;
}

const states: Map<AlertRuleKey, RuleState> =
  globalThis.__apertureAlertState ?? freshState();
globalThis.__apertureAlertState = states;

function stateFor(key: AlertRuleKey): RuleState {
  let state = states.get(key);
  if (!state) {
    state = { firing: false, consecutiveBad: 0, firingSince: null, lastDetail: '', lastStatus: 'ok' };
    states.set(key, state);
  }
  return state;
}

/**
 * Fold rule results into the firing state and emit transitions, mirroring the
 * `consecutive_failures` dedup in `dispatcher.ts`:
 *  - a bad result (`down`/`degraded`) fires only once `consecutiveBad` reaches
 *    `ALERT_DEBOUNCE_EVALUATIONS` (the debounce that honors "open > X min");
 *  - an `ok` result while firing resolves once and resets the counter;
 *  - `unknown` is a no-op — a DB-backed rule during a DB outage must not
 *    false-resolve; the `db` rule already owns that case.
 *
 * `now` is injectable for tests. Returns one `AlertTransition` per actual edge.
 */
export function reconcile(results: AlertRuleResult[], now: number = Date.now()): AlertTransition[] {
  const transitions: AlertTransition[] = [];
  for (const result of results) {
    if (result.status === 'unknown') continue;
    const state = stateFor(result.key);
    const bad = result.status === 'down' || result.status === 'degraded';
    if (bad) {
      state.consecutiveBad += 1;
      state.lastDetail = result.detail;
      state.lastStatus = result.status;
      if (!state.firing && state.consecutiveBad >= apertureConfig.ALERT_DEBOUNCE_EVALUATIONS) {
        state.firing = true;
        state.firingSince = now;
        transitions.push({ key: result.key, kind: 'fire', status: result.status, detail: result.detail, firingSince: now });
      }
    } else {
      if (state.firing) {
        transitions.push({
          key: result.key,
          kind: 'resolve',
          status: 'ok',
          detail: result.detail,
          firingSince: state.firingSince ?? now,
        });
      }
      state.firing = false;
      state.firingSince = null;
      state.consecutiveBad = 0;
      state.lastStatus = 'ok';
      state.lastDetail = result.detail;
    }
  }
  return transitions;
}

// --- Formatting (PII-free by construction: rule keys + counts only) ---

const STATUS_DOWN = 0xe74c3c; // red
const STATUS_DEGRADED = 0xf1c40f; // amber
const STATUS_RESOLVE = 0x2ecc71; // green

/** User-facing labels for the terse public status channel — no internals. */
const PUBLIC_LABEL: Record<AlertRuleKey, string> = {
  db: 'database connectivity',
  worker: 'background processing',
  esi_breakers: 'EVE ESI connectivity',
  job_abandoned: 'background processing',
  error_rate: 'application stability',
};

/**
 * Build the two Discord payloads for one transition: a terse, non-technical
 * `status` message for the public channel and a verbose `operator` embed.
 */
export function formatTransition(transition: AlertTransition): {
  status: DiscordWebhookPayload;
  operator: DiscordWebhookPayload;
} {
  const label = PUBLIC_LABEL[transition.key];
  const status: DiscordWebhookPayload =
    transition.kind === 'fire'
      ? { content: `⚠️ Aperture is experiencing issues with ${label}. We're investigating.` }
      : { content: `✅ Aperture ${label} is back to normal.` };

  const color =
    transition.kind === 'resolve'
      ? STATUS_RESOLVE
      : transition.status === 'down'
        ? STATUS_DOWN
        : STATUS_DEGRADED;
  const operator: DiscordWebhookPayload = {
    embeds: [
      {
        title: `${transition.kind === 'fire' ? '🔴 FIRING' : '🟢 RESOLVED'} — ${transition.key}`,
        description: transition.detail,
        color,
        timestamp: new Date().toISOString(),
        fields: [
          { name: 'Rule', value: transition.key, inline: true },
          { name: 'Status', value: transition.kind === 'fire' ? transition.status : 'ok', inline: true },
          { name: 'Firing since', value: `<t:${Math.floor(transition.firingSince / 1000)}:R>`, inline: true },
        ],
        footer: { text: 'Aperture alerting' },
      },
    ],
  };
  return { status, operator };
}

/** Test seam: clear all firing state between cases. */
export function __resetAlertStateForTest(): void {
  states.clear();
}
