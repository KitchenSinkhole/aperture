import { describe, expect, it } from 'vitest';
import { connectionBadges, connectionStyle, isEolEstimate } from '@/components/map/styling';
import type { MapConnectionEdge } from '@/types';

const edge = (
  overrides: Partial<MapConnectionEdge>,
): Pick<
  MapConnectionEdge,
  'scope' | 'massStatus' | 'jumpMassClass' | 'eolStage' | 'eolSource' | 'isStatic'
> => ({
  scope: 'wh',
  massStatus: 'fresh',
  jumpMassClass: null,
  eolStage: 'none',
  eolSource: null,
  isStatic: false,
  ...overrides,
});

describe('connection styling — estimated vs observed EOL', () => {
  const observed = edge({ eolStage: 'eol', eolSource: 'observed' });
  const estimated = edge({ eolStage: 'eol', eolSource: 'auto' });

  it('dashes both as EOL but with different patterns', () => {
    const o = connectionStyle(observed);
    const e = connectionStyle(estimated);
    expect(o.strokeDasharray).toBeDefined();
    expect(e.strokeDasharray).toBeDefined();
    expect(e.strokeDasharray).not.toBe(o.strokeDasharray);
    expect(e.stroke).toBe(o.stroke);
  });

  it('labels the estimate badge apart from the observed one', () => {
    const o = connectionBadges(observed).find((b) => b.key === 'eol');
    const e = connectionBadges(estimated).find((b) => b.key === 'eol');
    expect(o?.label).toBe('EOL');
    expect(e?.label).toBe('EOL?');
  });

  it('treats only an auto-sourced non-none stage as an estimate', () => {
    expect(isEolEstimate(estimated)).toBe(true);
    expect(isEolEstimate(observed)).toBe(false);
    expect(isEolEstimate(edge({}))).toBe(false);
    expect(isEolEstimate(edge({ eolStage: 'none', eolSource: 'observed' }))).toBe(false);
  });

  it('leaves the critical and expired stages unchanged by provenance', () => {
    for (const eolStage of ['critical', 'expired'] as const) {
      expect(connectionStyle(edge({ eolStage, eolSource: 'observed' }))).toEqual(
        connectionStyle(edge({ eolStage, eolSource: null })),
      );
    }
  });
});
