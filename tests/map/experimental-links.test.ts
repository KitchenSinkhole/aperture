import { describe, expect, it } from 'vitest';
import {
  connectionStyle,
  experimentalEolCountdownPillClass,
  experimentalEolOutlineClass,
  experimentalEolOutlineClassFromUrgency,
} from '@/components/map/styling';
import { homePathConnectionIds } from '@/lib/map/homePath';

describe('connectionStyle importance', () => {
  it('demotes fresh WH vs critical on light theme', () => {
    const fresh = connectionStyle(
      { scope: 'wh', massStatus: 'fresh', jumpMassClass: 'l', eolStage: 'none' },
      { importanceLinks: true, theme: 'light', palette: 'experimental' },
    );
    const critical = connectionStyle(
      { scope: 'wh', massStatus: 'critical', jumpMassClass: 'l', eolStage: 'none' },
      { importanceLinks: true, theme: 'light', palette: 'experimental' },
    );
    expect(critical.strokeWidth).toBeGreaterThan(fresh.strokeWidth ?? 0);
    expect(critical.strokeOpacity).toBeGreaterThan(fresh.strokeOpacity ?? 0);
  });

  it('stargate uses dotted faint stroke when importance on', () => {
    const sg = connectionStyle(
      { scope: 'stargate', massStatus: 'fresh', jumpMassClass: null, eolStage: 'none' },
      { importanceLinks: true, theme: 'dark', palette: 'experimental' },
    );
    expect(sg.strokeDasharray).toBe('2 5');
    expect(sg.strokeOpacity).toBeLessThan(0.5);
  });
});

describe('experimentalEolOutlineClass', () => {
  it('distinguishes eol vs critical and maps expired to red', () => {
    expect(experimentalEolOutlineClass('eol')).toContain('ap-connection-eol-stage-eol');
    expect(experimentalEolOutlineClass('critical')).toContain('ap-connection-eol-stage-critical');
    expect(experimentalEolOutlineClass('expired')).toContain('ap-connection-eol-stage-critical');
    expect(experimentalEolOutlineClass('none')).toBeNull();
  });
});

describe('experimentalEolCountdownPillClass', () => {
  it('maps urgency to countdown pill classes only', () => {
    expect(experimentalEolCountdownPillClass('warning')).toBe(
      'ap-connection-eol-countdown-pill-warning',
    );
    expect(experimentalEolCountdownPillClass('critical')).toBe(
      'ap-connection-eol-countdown-pill-critical',
    );
  });
});

describe('experimentalEolOutlineClassFromUrgency', () => {
  it('maps live urgency to orange or red outline classes', () => {
    expect(experimentalEolOutlineClassFromUrgency('warning')).toContain('ap-connection-eol-stage-eol');
    expect(experimentalEolOutlineClassFromUrgency('critical')).toContain(
      'ap-connection-eol-stage-critical',
    );
    expect(experimentalEolOutlineClassFromUrgency(null)).toBeNull();
  });
});

describe('homePathConnectionIds', () => {
  it('returns BFS tree edges from home', () => {
    const ids = homePathConnectionIds('1', [
      { id: 'a', source: '1', target: '2' },
      { id: 'b', source: '2', target: '3' },
      { id: 'c', source: '1', target: '4' },
    ]);
    expect(ids.has('a')).toBe(true);
    expect(ids.has('c')).toBe(true);
    expect(ids.has('b')).toBe(true);
  });
});
