import { describe, expect, it } from 'vitest';
import { eveTimezoneRows } from '@/components/chrome/EveTimeClock';

const at = (iso: string) => new Date(iso);

describe('eveTimezoneRows', () => {
  it('renders each bloc east-to-west with its local wall-clock range', () => {
    // 12:00 UTC on a Wednesday.
    const rows = eveTimezoneRows(at('2026-07-01T12:00:00Z'));
    expect(rows.map((r) => r.key)).toEqual(['AU', 'EU', 'US']);

    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    // AU +8..+10 → 20:00 - 22:00; EU +0..+3 → 12:00 - 15:00; US -8..-5 → 04:00 - 07:00.
    expect(byKey.AU!.range).toBe('20:00 - 22:00');
    expect(byKey.EU!.range).toBe('12:00 - 15:00');
    expect(byKey.US!.range).toBe('04:00 - 07:00');
  });

  it('reports the local weekday at the westmost edge of each bloc', () => {
    // 12:00 UTC Wed 2026-07-01: every bloc's westmost edge is still Wednesday.
    const rows = eveTimezoneRows(at('2026-07-01T12:00:00Z'));
    expect(rows.every((r) => r.weekday === 'Wed')).toBe(true);

    // Late UTC pushes AU across midnight into the next day.
    const late = eveTimezoneRows(at('2026-07-01T20:00:00Z'));
    const auLate = late.find((r) => r.key === 'AU')!;
    expect(auLate.weekday).toBe('Thu'); // +8 → 04:00 Thursday
  });
});
