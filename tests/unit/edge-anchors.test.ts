import { describe, expect, it } from 'vitest';
import { Position } from '@xyflow/react';
import {
  BASE_PITCH_PX,
  FACE_MARGIN_PX,
  anchorPoint,
  faceRank,
  pickFace,
  type IncidentEdge,
  type Rect,
} from '@/lib/map/edgeAnchors';

function rect(x: number, y: number, w = 20, h = 20): Rect {
  return { x, y, w, h };
}

describe('pickFace', () => {
  it('picks Right/Left for a clearly horizontal delta', () => {
    expect(pickFace(rect(0, 0), rect(100, 0))).toEqual({
      source: Position.Right,
      target: Position.Left,
    });
  });

  it('picks Left/Right for a clearly horizontal delta going the other way', () => {
    expect(pickFace(rect(100, 0), rect(0, 0))).toEqual({
      source: Position.Left,
      target: Position.Right,
    });
  });

  it('picks Bottom/Top for a clearly vertical delta', () => {
    expect(pickFace(rect(0, 0), rect(0, 100))).toEqual({
      source: Position.Bottom,
      target: Position.Top,
    });
  });

  it('picks Top/Bottom for a clearly vertical delta going the other way', () => {
    expect(pickFace(rect(0, 100), rect(0, 0))).toEqual({
      source: Position.Top,
      target: Position.Bottom,
    });
  });

  it('resolves the |dx| == |dy| tie to horizontal', () => {
    // Centres are 10px apart on each axis (rects are 20x20).
    expect(pickFace(rect(0, 0), rect(10, 10))).toEqual({
      source: Position.Right,
      target: Position.Left,
    });
  });

  it('picks vertical just past the tie boundary', () => {
    // dx = 9, dy = 10 -> |dy| > |dx|.
    expect(pickFace(rect(0, 0), rect(9, 10))).toEqual({
      source: Position.Bottom,
      target: Position.Top,
    });
  });

  it('picks horizontal just short of the tie boundary', () => {
    // dx = 11, dy = 10 -> |dx| > |dy|.
    expect(pickFace(rect(0, 0), rect(11, 10))).toEqual({
      source: Position.Right,
      target: Position.Left,
    });
  });

  it('target is always the opposite of source', () => {
    const cases: [Rect, Rect][] = [
      [rect(0, 0), rect(100, 0)],
      [rect(0, 0), rect(0, 100)],
      [rect(0, 0), rect(-100, 0)],
      [rect(0, 0), rect(0, -100)],
    ];
    const opposites: Record<Position, Position> = {
      [Position.Right]: Position.Left,
      [Position.Left]: Position.Right,
      [Position.Bottom]: Position.Top,
      [Position.Top]: Position.Bottom,
    };
    for (const [src, tgt] of cases) {
      const { source, target } = pickFace(src, tgt);
      expect(target).toBe(opposites[source]);
    }
  });

  it('is antisymmetric: swapping endpoints swaps source/target', () => {
    const a = rect(0, 0);
    const b = rect(37, 41);
    const forward = pickFace(a, b);
    const backward = pickFace(b, a);
    expect(backward.source).toBe(forward.target);
    expect(backward.target).toBe(forward.source);
  });
});

describe('faceRank', () => {
  it('orders Right-face edges by ascending departure angle', () => {
    const center = { x: 0, y: 0 };
    const incident: IncidentEdge[] = [
      { id: 'mid', otherCenter: { x: 100, y: 0 } },
      { id: 'top', otherCenter: { x: 100, y: -50 } },
      { id: 'bottom', otherCenter: { x: 100, y: 50 } },
    ];
    expect(faceRank(incident, center, Position.Right)).toEqual(['top', 'mid', 'bottom']);
  });

  it('ranks a distant shallow neighbour below a nearer steeper one on a Right face', () => {
    const center = { x: 0, y: 0 };
    // `far` sits higher in absolute y but heads away at a shallower angle, so
    // it must take the lower anchor or the two lines cross at the face.
    const incident: IncidentEdge[] = [
      { id: 'near', otherCenter: { x: 320, y: -100 } },
      { id: 'far', otherCenter: { x: 772, y: -110 } },
    ];
    expect(faceRank(incident, center, Position.Right)).toEqual(['near', 'far']);
  });

  it('ranks a distant shallow neighbour after a nearer steeper one on a Bottom face', () => {
    const center = { x: 0, y: 0 };
    const incident: IncidentEdge[] = [
      { id: 'near', otherCenter: { x: -100, y: 320 } },
      { id: 'far', otherCenter: { x: -110, y: 772 } },
    ];
    expect(faceRank(incident, center, Position.Bottom)).toEqual(['near', 'far']);
  });

  it('treats a neighbour coincident with the node centre as zero angle', () => {
    const center = { x: 0, y: 0 };
    const incident: IncidentEdge[] = [
      { id: 'coincident', otherCenter: { x: 0, y: 0 } },
      { id: 'up', otherCenter: { x: 100, y: -50 } },
      { id: 'down', otherCenter: { x: 100, y: 50 } },
    ];
    expect(faceRank(incident, center, Position.Right)).toEqual(['up', 'coincident', 'down']);
  });

  it('excludes edges attached to other faces', () => {
    const center = { x: 0, y: 0 };
    const incident: IncidentEdge[] = [
      { id: 'right', otherCenter: { x: 100, y: 0 } },
      { id: 'top', otherCenter: { x: 0, y: -100 } },
      { id: 'left', otherCenter: { x: -100, y: 0 } },
    ];
    expect(faceRank(incident, center, Position.Right)).toEqual(['right']);
    expect(faceRank(incident, center, Position.Top)).toEqual(['top']);
    expect(faceRank(incident, center, Position.Left)).toEqual(['left']);
    expect(faceRank(incident, center, Position.Bottom)).toEqual([]);
  });

  it('orders Top/Bottom-face edges by their x angle, not their y', () => {
    const center = { x: 0, y: 0 };
    const incident: IncidentEdge[] = [
      { id: 'right', otherCenter: { x: 50, y: 100 } },
      { id: 'left', otherCenter: { x: -50, y: 100 } },
      { id: 'mid', otherCenter: { x: 0, y: 100 } },
    ];
    expect(faceRank(incident, center, Position.Bottom)).toEqual(['left', 'mid', 'right']);
  });

  it('breaks ties to the same neighbour by edge id, stable across input order', () => {
    const center = { x: 0, y: 0 };
    const same = { x: 100, y: 0 };
    const incidentA: IncidentEdge[] = [
      { id: 'b', otherCenter: same },
      { id: 'a', otherCenter: same },
      { id: 'c', otherCenter: same },
    ];
    const incidentB: IncidentEdge[] = [
      { id: 'c', otherCenter: same },
      { id: 'a', otherCenter: same },
      { id: 'b', otherCenter: same },
    ];
    expect(faceRank(incidentA, center, Position.Right)).toEqual(['a', 'b', 'c']);
    expect(faceRank(incidentB, center, Position.Right)).toEqual(['a', 'b', 'c']);
  });
});

describe('anchorPoint', () => {
  const tallRect = rect(0, 0, 20, 45);

  it('n=1 sits at the face midpoint with zero offset', () => {
    expect(anchorPoint(tallRect, Position.Right, 0, 1)).toEqual({ x: 20, y: 22.5 });
  });

  it('n=2 splits symmetrically at +-pitch/2', () => {
    const pitch = BASE_PITCH_PX;
    const p0 = anchorPoint(tallRect, Position.Right, 0, 2);
    const p1 = anchorPoint(tallRect, Position.Right, 1, 2);
    expect(p0.y).toBeCloseTo(22.5 - pitch / 2);
    expect(p1.y).toBeCloseTo(22.5 + pitch / 2);
  });

  it('n=3 is -pitch, 0, +pitch around the midpoint', () => {
    const pitch = BASE_PITCH_PX;
    const p0 = anchorPoint(tallRect, Position.Right, 0, 3);
    const p1 = anchorPoint(tallRect, Position.Right, 1, 3);
    const p2 = anchorPoint(tallRect, Position.Right, 2, 3);
    expect(p0.y).toBeCloseTo(22.5 - pitch);
    expect(p1.y).toBeCloseTo(22.5);
    expect(p2.y).toBeCloseTo(22.5 + pitch);
  });

  it('n=5 spans -2*pitch..+2*pitch symmetrically', () => {
    const faceLength = 45;
    const pitch = Math.min(BASE_PITCH_PX, (faceLength - FACE_MARGIN_PX) / 4);
    const points = [0, 1, 2, 3, 4].map((i) => anchorPoint(tallRect, Position.Right, i, 5));
    expect(points.map((p) => p.y)).toEqual([
      22.5 - 2 * pitch,
      22.5 - pitch,
      22.5,
      22.5 + pitch,
      22.5 + pitch * 2,
    ]);
  });

  it('places the anchor on the correct face coordinate for each side', () => {
    const r = rect(10, 20, 30, 40);
    expect(anchorPoint(r, Position.Right, 0, 1)).toEqual({ x: 40, y: 40 });
    expect(anchorPoint(r, Position.Left, 0, 1)).toEqual({ x: 10, y: 40 });
    expect(anchorPoint(r, Position.Bottom, 0, 1)).toEqual({ x: 25, y: 60 });
    expect(anchorPoint(r, Position.Top, 0, 1)).toEqual({ x: 25, y: 20 });
  });

  it('does not clamp pitch at low degree on a tall face', () => {
    // faceLength=45, n=3 -> (45-8)/2 = 18.5 > BASE_PITCH_PX, so pitch stays at 12.
    const p2 = anchorPoint(tallRect, Position.Right, 2, 3);
    expect(p2.y).toBeCloseTo(22.5 + BASE_PITCH_PX);
  });

  it('clamps pitch at high degree so the fan stays within the face', () => {
    // faceLength=45, n=5 -> (45-8)/4 = 9.25 < BASE_PITCH_PX.
    const expectedPitch = (45 - FACE_MARGIN_PX) / 4;
    const points = [0, 1, 2, 3, 4].map((i) => anchorPoint(tallRect, Position.Right, i, 5));
    const first = anchorPoint(tallRect, Position.Right, 0, 5);
    const last = anchorPoint(tallRect, Position.Right, 4, 5);
    const span = last.y - first.y;
    expect(span).toBeCloseTo(4 * expectedPitch);
    expect(expectedPitch).toBeLessThan(BASE_PITCH_PX);
    for (const p of points) {
      expect(p.y).toBeGreaterThanOrEqual(tallRect.y);
      expect(p.y).toBeLessThanOrEqual(tallRect.y + tallRect.h);
    }
  });
});
