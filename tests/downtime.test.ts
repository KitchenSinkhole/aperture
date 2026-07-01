import { describe, expect, it } from 'vitest';
import { eveClockPhase, minutesUntilDowntime } from '@/lib/esi/downtime';

// Config downtime is 11:00 UTC with a ±9m padded window.
const at = (iso: string) => new Date(iso);

describe('minutesUntilDowntime', () => {
  it('counts whole minutes to the next 11:00 UTC', () => {
    expect(minutesUntilDowntime(at('2026-07-01T04:00:00Z'))).toBe(420);
    expect(minutesUntilDowntime(at('2026-07-01T10:06:00Z'))).toBe(54);
    expect(minutesUntilDowntime(at('2026-07-01T10:59:00Z'))).toBe(1);
  });

  it('wraps past midnight and past the downtime minute', () => {
    expect(minutesUntilDowntime(at('2026-07-01T23:30:00Z'))).toBe(690);
    // At exactly 11:00 the next downtime is a full day away.
    expect(minutesUntilDowntime(at('2026-07-01T11:00:00Z'))).toBe(1440);
  });
});

describe('eveClockPhase', () => {
  it('is normal outside the hour before downtime', () => {
    expect(eveClockPhase(at('2026-07-01T04:00:00Z'))).toBe('normal');
  });

  it('is pre-downtime in the hour before, including the DT-54m case', () => {
    expect(eveClockPhase(at('2026-07-01T10:06:00Z'))).toBe('pre');
    expect(eveClockPhase(at('2026-07-01T10:59:00Z'))).toBe('pre');
  });

  it('is downtime inside the padded window', () => {
    expect(eveClockPhase(at('2026-07-01T11:03:00Z'))).toBe('downtime');
  });
});
