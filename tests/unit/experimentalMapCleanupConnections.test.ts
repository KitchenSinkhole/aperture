import { describe, expect, it } from 'vitest';
import { connectionsForExperimentalMapCleanup } from '@/lib/map/experimentalMapCleanupConnections';
import type { MapConnectionEdge } from '@/types';

const edge = (eolStage: MapConnectionEdge['eolStage']): MapConnectionEdge =>
  ({
    id: '1',
    eolStage,
  }) as MapConnectionEdge;

describe('connectionsForExperimentalMapCleanup', () => {
  it('keeps only expired-stage connections', () => {
    const rows = connectionsForExperimentalMapCleanup([
      edge('none'),
      edge('eol'),
      edge('expired'),
      edge('critical'),
    ]);
    expect(rows.map((r) => r.eolStage)).toEqual(['expired']);
  });
});