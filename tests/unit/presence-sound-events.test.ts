import { describe, expect, it } from 'vitest';
import {
  classifyTraversal,
  watchedJumpVariant,
  type TraversalLike,
} from '@/lib/sounds/presenceEvents';

const MY_SYSTEM = 31000005;
const ELSEWHERE = 30000142;
const FAR = 30002187;

function jump(characterId: number, fromSystemId: number, toSystemId: number): TraversalLike {
  return { characterId, fromSystemId, toSystemId };
}

const viewerIds = new Set([100, 101]);

describe('classifyTraversal', () => {
  it('reports an arrival when a tracked pilot jumps into my system', () => {
    expect(classifyTraversal(jump(200, ELSEWHERE, MY_SYSTEM), MY_SYSTEM, viewerIds)).toBe(
      'pilotArrived',
    );
  });

  it('reports a departure when a tracked pilot jumps out of my system', () => {
    expect(classifyTraversal(jump(200, MY_SYSTEM, ELSEWHERE), MY_SYSTEM, viewerIds)).toBe(
      'pilotLeft',
    );
  });

  it('stays silent for a jump between two other systems', () => {
    expect(classifyTraversal(jump(200, ELSEWHERE, FAR), MY_SYSTEM, viewerIds)).toBeNull();
  });

  it("stays silent for the viewer's own characters, in either direction", () => {
    expect(classifyTraversal(jump(100, ELSEWHERE, MY_SYSTEM), MY_SYSTEM, viewerIds)).toBeNull();
    expect(classifyTraversal(jump(101, MY_SYSTEM, ELSEWHERE), MY_SYSTEM, viewerIds)).toBeNull();
  });

  it('stays silent when no active character is located', () => {
    expect(classifyTraversal(jump(200, ELSEWHERE, MY_SYSTEM), null, viewerIds)).toBeNull();
    expect(classifyTraversal(jump(200, MY_SYSTEM, ELSEWHERE), null, viewerIds)).toBeNull();
  });

  it('treats an empty viewer roster as all-foreign', () => {
    expect(classifyTraversal(jump(100, ELSEWHERE, MY_SYSTEM), MY_SYSTEM, new Set())).toBe(
      'pilotArrived',
    );
  });
});

describe('watchedJumpVariant', () => {
  it('is inbound when the jump ends in my system', () => {
    expect(watchedJumpVariant(jump(200, ELSEWHERE, MY_SYSTEM), MY_SYSTEM)).toBe('inbound');
  });

  it('is outbound when the jump starts in my system', () => {
    expect(watchedJumpVariant(jump(200, MY_SYSTEM, ELSEWHERE), MY_SYSTEM)).toBe('outbound');
  });

  it('is plain when the jump happens away from me', () => {
    expect(watchedJumpVariant(jump(200, ELSEWHERE, FAR), MY_SYSTEM)).toBe('plain');
  });

  it('is plain when I have no located character', () => {
    expect(watchedJumpVariant(jump(200, ELSEWHERE, MY_SYSTEM), null)).toBe('plain');
  });
});
