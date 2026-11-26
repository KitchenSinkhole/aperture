import { describe, expect, it } from 'vitest';
import { resolveSignaturePasteTargetSystem } from '@/components/map/SignaturePasteHotkey';
import type { MapSystemNode } from '@/types';

const node = (id: string): MapSystemNode =>
  ({
    id,
    mapId: '1',
    systemId: 42,
    name: 'Jita',
    alias: null,
    tag: null,
    status: 'active',
    locked: false,
    visible: true,
    rallyAt: null,
    x: 0,
    y: 0,
  }) as unknown as MapSystemNode;

describe('resolveSignaturePasteTargetSystem', () => {
  it('prefers the selected system', () => {
    expect(resolveSignaturePasteTargetSystem(node('a'), node('b'))).toEqual(node('a'));
  });

  it('uses fallback only when nothing is selected', () => {
    expect(resolveSignaturePasteTargetSystem(null, node('b'))).toEqual(node('b'));
  });

  it('returns null when fallback is omitted (legacy)', () => {
    expect(resolveSignaturePasteTargetSystem(null, null)).toBeNull();
    expect(resolveSignaturePasteTargetSystem(null, undefined)).toBeNull();
  });
});