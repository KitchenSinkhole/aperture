import { describe, expect, it } from 'vitest';
import { resolveTransit } from '@/lib/map/transitResolve';
import type { MapConnectionEdge, MapSystemNode } from '@/types';

const SOURCE = 100;
const DEST = 200;

function system(id: string, systemId: number): MapSystemNode {
  return { id, systemId, name: `J${systemId}`, alias: null } as unknown as MapSystemNode;
}

function connection(
  id: string,
  source: string,
  target: string,
  scope: 'wh' | 'stargate' = 'wh',
): MapConnectionEdge {
  return { id, source, target, scope } as unknown as MapConnectionEdge;
}

const src = system('src', SOURCE);
const dst = system('dst', DEST);
const systems = [src, dst];

describe('resolveTransit', () => {
  it('resolves the wh connection between the two systems', () => {
    const wh = connection('conn-wh', 'src', 'dst', 'wh');
    expect(resolveTransit({ fromSystemId: SOURCE, toSystemId: DEST }, systems, [wh])).toEqual({
      kind: 'resolved',
      here: dst,
      cameFrom: src,
      connection: wh,
    });
  });

  it('matches a connection recorded in the opposite direction to the jump', () => {
    const wh = connection('conn-wh', 'dst', 'src', 'wh');
    expect(resolveTransit({ fromSystemId: SOURCE, toSystemId: DEST }, systems, [wh])).toEqual({
      kind: 'resolved',
      here: dst,
      cameFrom: src,
      connection: wh,
    });
  });

  it('drops a gate jump (a stargate connection between the two systems)', () => {
    const gate = connection('conn-gate', 'src', 'dst', 'stargate');
    expect(resolveTransit({ fromSystemId: SOURCE, toSystemId: DEST }, systems, [gate])).toEqual({
      kind: 'drop',
    });
  });

  it('drops when a stargate sits alongside a wh connection between the two systems', () => {
    const gate = connection('conn-gate', 'src', 'dst', 'stargate');
    const wh = connection('conn-wh', 'src', 'dst', 'wh');
    expect(resolveTransit({ fromSystemId: SOURCE, toSystemId: DEST }, systems, [wh, gate])).toEqual({
      kind: 'drop',
    });
  });

  it('is pending when one of the endpoint systems is not yet on the map', () => {
    expect(resolveTransit({ fromSystemId: SOURCE, toSystemId: 999999 }, systems, [])).toEqual({
      kind: 'pending',
    });
  });

  it('is pending when both systems are on the map but no connection links them yet', () => {
    expect(resolveTransit({ fromSystemId: SOURCE, toSystemId: DEST }, systems, [])).toEqual({
      kind: 'pending',
    });
  });

  it('ignores a connection that does not join the two endpoints', () => {
    const other = system('other', 300);
    const elsewhere = connection('conn-other', 'dst', 'other', 'wh');
    expect(
      resolveTransit({ fromSystemId: SOURCE, toSystemId: DEST }, [...systems, other], [elsewhere]),
    ).toEqual({ kind: 'pending' });
  });
});

