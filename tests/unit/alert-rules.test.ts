// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { apertureConfig } from '../../aperture.config';
import {
  __resetAlertStateForTest,
  evaluateRules,
  formatTransition,
  reconcile,
} from '@/lib/alerts/rules';
import type { AlertRuleResult, AlertSignals } from '@/types';

// Phase 6 alerting is deliberately DB-free: rules are pure and firing state is
// in-memory, so the dedup state machine is fully unit-testable without a DB.

const HEALTHY: AlertSignals = {
  dbProbeMs: 5,
  workerStaleMs: 1_000,
  openBreakers: 0,
  abandonedJobs: 0,
  recentErrors: 0,
};

const dbDown: AlertRuleResult = { key: 'db', status: 'down', detail: 'Database probe failed.' };
const dbOk: AlertRuleResult = { key: 'db', status: 'ok', detail: 'Database responsive.' };

beforeEach(() => {
  __resetAlertStateForTest();
});

describe('evaluateRules', () => {
  it('reports all-ok for healthy signals', () => {
    expect(evaluateRules(HEALTHY).every((r) => r.status === 'ok')).toBe(true);
  });

  it('maps a failed DB probe to down and a slow probe to degraded', () => {
    const down = evaluateRules({ ...HEALTHY, dbProbeMs: null });
    expect(down.find((r) => r.key === 'db')?.status).toBe('down');

    const slow = evaluateRules({ ...HEALTHY, dbProbeMs: apertureConfig.ALERT_DB_SLOW_MS + 1 });
    expect(slow.find((r) => r.key === 'db')?.status).toBe('degraded');
  });

  it('maps an unreachable DB-backed signal to unknown, not a false ok', () => {
    const r = evaluateRules({ ...HEALTHY, workerStaleMs: null, recentErrors: null, abandonedJobs: null });
    expect(r.find((x) => x.key === 'worker')?.status).toBe('unknown');
    expect(r.find((x) => x.key === 'error_rate')?.status).toBe('unknown');
    expect(r.find((x) => x.key === 'job_abandoned')?.status).toBe('unknown');
  });

  it('fires esi_breakers at the configured threshold', () => {
    const below = evaluateRules({ ...HEALTHY, openBreakers: apertureConfig.ALERT_ESI_BREAKERS_OPEN_THRESHOLD - 1 });
    expect(below.find((r) => r.key === 'esi_breakers')?.status).toBe('ok');
    const at = evaluateRules({ ...HEALTHY, openBreakers: apertureConfig.ALERT_ESI_BREAKERS_OPEN_THRESHOLD });
    expect(at.find((r) => r.key === 'esi_breakers')?.status).toBe('degraded');
  });
});

describe('reconcile dedup state machine', () => {
  it('does not fire until consecutive bad ticks reach the debounce, then fires once', () => {
    // DEBOUNCE = 2: first bad tick is silent, the second fires.
    expect(reconcile([dbDown])).toEqual([]);
    const fired = reconcile([dbDown]);
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({ key: 'db', kind: 'fire', status: 'down' });
  });

  it('does not re-fire while already firing', () => {
    reconcile([dbDown]);
    reconcile([dbDown]); // fires here
    expect(reconcile([dbDown])).toEqual([]);
    expect(reconcile([dbDown])).toEqual([]);
  });

  it('resolves exactly once on recovery and never again', () => {
    reconcile([dbDown]);
    reconcile([dbDown]); // firing
    const resolved = reconcile([dbOk]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({ key: 'db', kind: 'resolve', status: 'ok' });
    // Subsequent ok ticks are silent.
    expect(reconcile([dbOk])).toEqual([]);
  });

  it('requires the debounce again after a resolve (no sticky firing)', () => {
    reconcile([dbDown]);
    reconcile([dbDown]); // fire
    reconcile([dbOk]); // resolve, counter reset
    expect(reconcile([dbDown])).toEqual([]); // one bad tick is not enough again
    expect(reconcile([dbDown])).toHaveLength(1);
  });

  it('treats unknown as a no-op — never fires or resolves', () => {
    const unknown: AlertRuleResult = { key: 'worker', status: 'unknown', detail: '' };
    expect(reconcile([unknown])).toEqual([]);
    expect(reconcile([unknown])).toEqual([]);
    expect(reconcile([unknown])).toEqual([]);
  });

  it('fires the db rule during a DB outage while DB-backed rules stay silent (unknown)', () => {
    // The outage gather: db probe failed, every DB-backed signal null, breakers in-process.
    const outage = evaluateRules({
      dbProbeMs: null,
      workerStaleMs: null,
      abandonedJobs: null,
      recentErrors: null,
      openBreakers: 0,
    });
    reconcile(outage);
    const transitions = reconcile(outage);
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({ key: 'db', kind: 'fire' });
  });
});

describe('formatTransition', () => {
  it('builds a terse public message and a verbose operator embed', () => {
    reconcile([dbDown]);
    const [fire] = reconcile([dbDown]);
    const { status, operator } = formatTransition(fire!);
    expect(status.content).toMatch(/database connectivity/i);
    expect(status.embeds).toBeUndefined(); // public channel: plain text only
    expect(operator.embeds?.[0]?.title).toContain('FIRING');
    // PII-free: payloads carry rule keys + counts, no names/IPs.
    expect(JSON.stringify({ status, operator })).not.toMatch(/@|\bip\b/i);
  });
});
