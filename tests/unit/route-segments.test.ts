import { describe, expect, it } from 'vitest';
import {
  formatRouteInstructions,
  formatRouteSegment,
  routeSpaceKind,
  segmentRoute,
} from '@/lib/map/routeSegments';
import type { RouteHop, RoutePlan } from '@/types';

// Pure-algorithm tests for route segmentation (routes-module). No DB — builds
// synthetic `RoutePlan`s from a compact hop spec.

type HopSpec = {
  /** System name; `J######` doubles as the J-space marker when `sec` is omitted. */
  name: string;
  sec?: string | null;
  via?: RouteHop['via'];
  sig?: string | null;
  tag?: string | null;
  id?: number;
};

let nextSystemId = 1;

function plan(specs: HopSpec[], reachable = true): RoutePlan {
  const hops: RouteHop[] = specs.map((s, i) => ({
    systemId: s.id ?? nextSystemId++,
    name: s.name,
    security: s.sec ?? null,
    securityStatus: null,
    via: i === 0 ? 'origin' : (s.via ?? 'gate'),
    connectionId: s.via === 'wh' || s.via === 'jumpbridge' ? 900 + i : null,
    onMap: true,
    tag: s.tag ?? null,
    viaSigId: s.sig ?? null,
  }));
  const last = hops[hops.length - 1]!;
  return {
    destinationSystemId: last.systemId,
    destinationName: last.name,
    reachable,
    jumps: hops.length - 1,
    hops,
  };
}

function kinds(p: RoutePlan): string[] {
  return segmentRoute(p).map((s) => s.kind);
}

function lines(p: RoutePlan): string[] {
  return segmentRoute(p).map((s) => formatRouteSegment(s));
}

describe('routeSpaceKind', () => {
  it('classifies K-space security labels', () => {
    expect(routeSpaceKind('H', 'Amarr')).toBe('kspace');
    expect(routeSpaceKind('L', 'Rancer')).toBe('kspace');
    expect(routeSpaceKind('0.0', 'HED-GP')).toBe('kspace');
  });

  it('classifies every wormhole class, including Thera (C12) and shattered (C13)', () => {
    for (const c of ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C13', 'C14', 'C18']) {
      expect(routeSpaceKind(c, 'J123456')).toBe('jspace');
    }
    expect(routeSpaceKind('C12', 'Thera')).toBe('jspace');
  });

  it('classifies Pochven and Abyssal separately from K-space', () => {
    expect(routeSpaceKind('P', 'Krirald')).toBe('pochven');
    expect(routeSpaceKind('A', 'Abyssal')).toBe('abyssal');
  });

  it('falls back to the J###### name form when the label is missing', () => {
    expect(routeSpaceKind(null, 'J170122')).toBe('jspace');
    expect(routeSpaceKind(null, 'Jita')).toBe('unknown');
  });

  it('treats Turnur as K-space despite being an EVE-Scout hub', () => {
    expect(routeSpaceKind('L', 'Turnur')).toBe('kspace');
  });
});

describe('system labelling', () => {
  // `ap_map_system.tag` holds only the letter; the class supplies the prefix, so
  // class C1 + tag B reads C1B — the pair the map tile stacks together.
  it('names a tagged J-space system by class and tag together', () => {
    const segs = segmentRoute(
      plan([
        { name: 'J105443', sec: 'C1', tag: 'B' },
        { name: 'J100744', sec: 'C4', via: 'wh', sig: 'AAA', tag: 'A' },
      ]),
    );
    expect(segs[0]!.from.label).toBe('C1B');
    expect(segs[0]!.to.label).toBe('C4A');
  });

  it('falls back to the J###### name for an untagged J-space system', () => {
    const segs = segmentRoute(
      plan([
        { name: 'J105443', sec: 'C1' },
        { name: 'J100744', sec: 'C1', via: 'wh', sig: 'AAA' },
      ]),
    );
    expect(segs[0]!.from.label).toBe('J105443');
  });

  it('always names a K-space system by its real name, tagged or not', () => {
    const segs = segmentRoute(
      plan([
        { name: 'Amarr', sec: 'H', tag: 'STAGE' },
        { name: 'Ashab', sec: 'H' },
      ]),
    );
    expect(segs[0]!.from.label).toBe('Amarr');
  });
});

describe('segmentRoute — gate runs', () => {
  it('merges a gate run across security bands into one segment', () => {
    const p = plan([
      { name: 'Amarr', sec: 'H' },
      { name: 'Ashab', sec: 'H' },
      { name: 'Rancer', sec: 'L' },
      { name: 'HED-GP', sec: '0.0' },
    ]);
    const segs = segmentRoute(p);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.kind).toBe('gate_run');
    expect(segs[0]!.jumps).toBe(3);
    expect(formatRouteSegment(segs[0]!)).toBe('In Amarr, burn 3 jumps to HED-GP.');
  });

  it('reads a single gate jump as a gate, not a burn', () => {
    expect(lines(plan([{ name: 'Amarr', sec: 'H' }, { name: 'Ashab', sec: 'H' }]))).toEqual([
      'In Amarr, gate to Ashab.',
    ]);
  });
});

describe('segmentRoute — J-space chains', () => {
  it('collapses a J-space-only route into one chain run', () => {
    const p = plan([
      { name: 'J100001', sec: 'C5', tag: 'B' },
      { name: 'J100002', sec: 'C5', via: 'wh', sig: 'AAA' },
      { name: 'J100003', sec: 'C3', via: 'wh', sig: 'BBB' },
      { name: 'J100004', sec: 'C5', via: 'wh', sig: 'CCC' },
      { name: 'J100005', sec: 'C5', via: 'wh', sig: 'DDD', tag: 'A' },
    ]);
    const segs = segmentRoute(p);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.kind).toBe('chain_run');
    expect(segs[0]!.jumps).toBe(4);
    expect(formatRouteSegment(segs[0]!)).toBe('In C5B, follow the chain 4 jumps to C5A.');
  });

  it('names the sig for a one-jump chain run', () => {
    const p = plan([
      { name: 'J100001', sec: 'C5', tag: 'B' },
      { name: 'J100002', sec: 'C5', via: 'wh', sig: 'AAA', tag: 'A' },
    ]);
    expect(lines(p)).toEqual(['In C5B, follow the chain to C5A via AAA.']);
  });
});

describe('segmentRoute — wormhole crossings', () => {
  it('merges a one-system K->J->K shortcut into a single transit', () => {
    const p = plan([
      { name: 'Amarr', sec: 'H' },
      { name: 'J100001', sec: 'C5', via: 'wh', sig: 'BSA', tag: 'A' },
      { name: 'Jita', sec: 'H', via: 'wh', sig: 'SOF' },
    ]);
    const segs = segmentRoute(p);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.kind).toBe('wh_transit');
    expect(segs[0]!.through?.label).toBe('C5A');
    expect(segs[0]!.entrySigId).toBe('BSA');
    expect(segs[0]!.exitSigId).toBe('SOF');
    expect(formatRouteSegment(segs[0]!)).toBe(
      'In Amarr, enter C5A via BSA, then exit to Jita via SOF.',
    );
  });

  it('keeps enter / chain / exit separate when two or more J-space systems are traversed', () => {
    const p = plan([
      { name: 'Amarr', sec: 'H' },
      { name: 'J100001', sec: 'C5', via: 'wh', sig: 'BSA', tag: 'A' },
      { name: 'J100002', sec: 'C5', via: 'wh', sig: 'MID' },
      { name: 'J100003', sec: 'C5', via: 'wh', sig: 'XYZ', tag: 'C' },
      { name: 'Jita', sec: 'H', via: 'wh', sig: 'SOF' },
    ]);
    expect(kinds(p)).toEqual(['wh_jump', 'chain_run', 'wh_jump']);
    expect(lines(p)).toEqual([
      'In Amarr, enter C5A via BSA.',
      'In C5A, follow the chain 2 jumps to C5C.',
      'In C5C, exit to Jita via SOF.',
    ]);
  });

  it('labels a K-space to K-space wormhole as a lateral jump', () => {
    const p = plan([
      { name: 'Amarr', sec: 'H' },
      { name: 'Jita', sec: 'H', via: 'wh', sig: 'QQR' },
    ]);
    const segs = segmentRoute(p);
    expect(segs[0]!.direction).toBe('lateral');
    expect(formatRouteSegment(segs[0]!)).toBe('In Amarr, jump to Jita via QQR.');
  });

  it('treats entering Pochven as a crossing, and its internal gates as a burn', () => {
    const p = plan([
      { name: 'Amarr', sec: 'H' },
      { name: 'Krirald', sec: 'P', via: 'wh', sig: 'TRG' },
      { name: 'Skarkon', sec: 'P' },
    ]);
    expect(kinds(p)).toEqual(['wh_jump', 'gate_run']);
    expect(segmentRoute(p)[0]!.direction).toBe('lateral');
  });

  it('renders a placeholder when the departure sig is unrecorded', () => {
    const p = plan([
      { name: 'Amarr', sec: 'H' },
      { name: 'J100001', sec: 'C5', via: 'wh', sig: null, tag: 'A' },
    ]);
    expect(lines(p)).toEqual(['In Amarr, enter C5A via an unscanned sig.']);
  });
});

describe('segmentRoute — other edge kinds', () => {
  it('gives a jumpbridge its own segment and never folds it into a gate run', () => {
    const p = plan([
      { name: 'Amarr', sec: 'H' },
      { name: 'Ashab', sec: 'H' },
      { name: '1DQ1-A', sec: '0.0', via: 'jumpbridge' },
      { name: 'T5ZI-S', sec: '0.0' },
    ]);
    expect(kinds(p)).toEqual(['gate_run', 'jumpbridge', 'gate_run']);
    expect(lines(p)[1]).toBe('In Ashab, take the jumpbridge to 1DQ1-A.');
  });

  it('gives a one-way EVE-Scout connection its own segment', () => {
    const p = plan([
      { name: 'Amarr', sec: 'H' },
      { name: 'Thera', sec: 'C12', via: 'eve_scout' },
    ]);
    expect(kinds(p)).toEqual(['eve_scout']);
    expect(lines(p)).toEqual(['In Amarr, take the EVE-Scout connection to Thera.']);
  });

  // Thera is J-space (C12) but Turnur is lowsec K-space, so the transit merge
  // keys on the edge kind rather than the space either side of the hub.
  it('merges a transit through Thera into one EVE-Scout instruction', () => {
    const p = plan([
      { name: 'Amarr', sec: 'H' },
      { name: 'Thera', sec: 'C12', via: 'eve_scout' },
      { name: 'Dodixie', sec: 'H', via: 'eve_scout' },
    ]);
    const segs = segmentRoute(p);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.kind).toBe('eve_scout_transit');
    expect(segs[0]!.through?.label).toBe('Thera');
    expect(formatRouteSegment(segs[0]!)).toBe(
      'In Amarr, use EVE-Scout to transit through Thera to Dodixie.',
    );
  });

  it('merges a transit through Turnur the same way despite it being K-space', () => {
    const p = plan([
      { name: 'Amarr', sec: 'H' },
      { name: 'Turnur', sec: 'L', via: 'eve_scout' },
      { name: 'Hek', sec: 'H', via: 'eve_scout' },
    ]);
    expect(kinds(p)).toEqual(['eve_scout_transit']);
    expect(lines(p)).toEqual(['In Amarr, use EVE-Scout to transit through Turnur to Hek.']);
  });

  it('does not merge an EVE-Scout hop with an adjacent gate or wormhole hop', () => {
    const p = plan([
      { name: 'Amarr', sec: 'H' },
      { name: 'Thera', sec: 'C12', via: 'eve_scout' },
      { name: 'J100001', sec: 'C5', via: 'wh', sig: 'AAA' },
    ]);
    expect(kinds(p)).toEqual(['eve_scout', 'chain_run']);
  });
});

describe('formatRouteInstructions', () => {
  const mixed = () =>
    segmentRoute(
      plan([
        { name: 'Amarr', sec: 'H', tag: 'STAGE' },
        { name: 'J105443', sec: 'C4', via: 'wh', sig: 'BSA', tag: 'A' },
        { name: 'Jita', sec: 'H', via: 'wh', sig: 'SOF' },
      ]),
    );

  it('prefixes a route header naming origin and destination', () => {
    expect(formatRouteInstructions(mixed())).toBe(
      [
        'Route Amarr -> Jita',
        '1. In Amarr, enter C4A via BSA, then exit to Jita via SOF.',
      ].join('\n'),
    );
  });

  it('emits plain text with no markup', () => {
    expect(formatRouteInstructions(mixed())).not.toContain('<');
  });

  it('numbers every step on its own line', () => {
    const segs = segmentRoute(
      plan([
        { name: 'Amarr', sec: 'H' },
        { name: 'J105443', sec: 'C4', via: 'wh', sig: 'BSA', tag: 'A' },
        { name: 'J105444', sec: 'C4', via: 'wh', sig: 'MID', tag: 'B' },
        { name: 'Jita', sec: 'H', via: 'wh', sig: 'SOF' },
      ]),
    );
    expect(formatRouteInstructions(segs).split('\n')).toEqual([
      'Route Amarr -> Jita',
      '1. In Amarr, enter C4A via BSA.',
      '2. In C4A, follow the chain to C4B via MID.',
      '3. In C4B, exit to Jita via SOF.',
    ]);
  });

  it('returns an empty string for a route with no segments', () => {
    expect(formatRouteInstructions([])).toBe('');
  });
});

describe('segmentRoute — degenerate plans', () => {
  it('reports a source-equals-destination plan as origin_only', () => {
    const p = plan([{ name: 'Amarr', sec: 'H' }]);
    expect(kinds(p)).toEqual(['origin_only']);
    expect(lines(p)).toEqual(['You are already in Amarr.']);
  });

  it('returns no segments for an unreachable plan', () => {
    expect(segmentRoute(plan([{ name: 'Amarr', sec: 'H' }], false))).toEqual([]);
  });
});

describe('segmentRoute — hop index contract', () => {
  // The breadcrumb annotates its markers from these ranges, so they must tile
  // the hop list end to end with no gap or overlap.
  it('tiles the hop list across a mixed route', () => {
    const p = plan([
      { name: 'Amarr', sec: 'H' },
      { name: 'Ashab', sec: 'H' },
      { name: 'Rancer', sec: 'L' },
      { name: 'J100001', sec: 'C5', via: 'wh', sig: 'BSA' },
      { name: 'J100002', sec: 'C5', via: 'wh', sig: 'MID' },
      { name: 'J100003', sec: 'C5', via: 'wh', sig: 'XYZ' },
      { name: 'Jita', sec: 'H', via: 'wh', sig: 'SOF' },
      { name: 'Perimeter', sec: 'H' },
    ]);
    const segs = segmentRoute(p);
    expect(segs.map((s) => s.kind)).toEqual([
      'gate_run',
      'wh_jump',
      'chain_run',
      'wh_jump',
      'gate_run',
    ]);
    expect(segs[0]!.fromHopIndex).toBe(0);
    expect(segs[segs.length - 1]!.toHopIndex).toBe(p.hops.length - 1);
    for (const s of segs) {
      expect(s.jumps).toBe(s.toHopIndex - s.fromHopIndex);
      expect(s.jumps).toBeGreaterThan(0);
    }
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i]!.fromHopIndex).toBe(segs[i - 1]!.toHopIndex);
    }
  });

  it('tiles the hop list when a transit merge is involved', () => {
    const p = plan([
      { name: 'Amarr', sec: 'H' },
      { name: 'J100001', sec: 'C5', via: 'wh', sig: 'BSA' },
      { name: 'Jita', sec: 'H', via: 'wh', sig: 'SOF' },
      { name: 'Perimeter', sec: 'H' },
    ]);
    const segs = segmentRoute(p);
    expect(segs.map((s) => [s.fromHopIndex, s.toHopIndex])).toEqual([
      [0, 2],
      [2, 3],
    ]);
  });
});
